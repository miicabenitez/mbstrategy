// netlify/functions/mp-webhook.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();
const auth = getAuth();
const HEADERS = { 'Content-Type': 'application/json' };

function verificarFirma(event) {
  const xSignature = event.headers['x-signature'];
  const xRequestId = event.headers['x-request-id'];
  const dataId = JSON.parse(event.body || '{}')?.data?.id;
  if (!xSignature || !xRequestId || !dataId) return false;
  const parts = {};
  xSignature.split(',').forEach(part => {
    const [k, v] = part.trim().split('=');
    parts[k] = v;
  });
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${parts.ts};`;
  const hmac = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET);
  hmac.update(manifest);
  const expected = hmac.digest('hex');
  if (!parts.v1) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(parts.v1, 'utf8'));
  } catch(e) {
    return false;
  }
}

function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 9; i++) {
    pass += chars[crypto.randomInt(chars.length)];
  }
  return pass;
}

function formatTrialEnd(date) {
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${date.getDate()} de ${meses[date.getMonth()]} de ${date.getFullYear()}`;
}

async function enviarWelcomeEmail(data) {
  const { handler } = require('./send-welcome-email');
  const event = {
    httpMethod: 'POST',
    body: JSON.stringify(data)
  };
  try {
    const result = await handler(event);
    console.log('Welcome email result:', result.statusCode);
  } catch (e) {
    console.error('Error enviando welcome email:', e);
  }
}

async function notificarPushover({ nombreCliente, email, plan, monto }) {
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: process.env.PUSHOVER_TOKEN,
        user: process.env.PUSHOVER_USER,
        title: '🎉 Nueva suscripción',
        message: `👤 ${nombreCliente}\n📧 ${email}\n📦 Plan ${plan}\n💰 ${monto}/mes`,
        priority: 0
      })
    });
  } catch (e) {
    console.error('Error notificando Pushover:', e);
  }
}


exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  }
  if (!verificarFirma(event)) {
    console.warn('Webhook rechazado: firma inválida');
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Firma inválida' }) };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const { type, data } = body;

    // Deduplicación: verificar si este webhook ya fue procesado
    // TODO: cleanup — agregar TTL de 7 días via Cloud Function scheduled o batch delete
    const xRequestId = event.headers['x-request-id'];
    if (xRequestId) {
      const dedupSnap = await db.collection('webhookProcessed').doc(xRequestId).get();
      if (dedupSnap.exists) {
        console.log('Webhook duplicado ignorado:', xRequestId);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Ya procesado (duplicado)' }) };
      }
      await db.collection('webhookProcessed').doc(xRequestId).set({
        timestamp: FieldValue.serverTimestamp(),
        type: type || 'unknown',
        dataId: data?.id || null
      });
    }

    if (type !== 'subscription_preapproval') {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Evento ignorado' }) };
    }
    const subscriptionId = data?.id;
    if (!subscriptionId) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'ID de suscripción faltante' }) };
    }
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${subscriptionId}`, {
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const sub = await mpRes.json();
    console.log('SUB COMPLETO:', JSON.stringify(sub));
    if (!mpRes.ok) {
      console.error('MP fetch error:', sub);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Error consultando MP' }) };
    }
    const externalRef = sub.external_reference;
    if (!externalRef) {
      console.warn('Suscripción sin external_reference:', subscriptionId);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Sin external_reference' }) };
    }

    const estadoMap = {
      authorized: 'activo',
      paused:     'pausado',
      cancelled:  'cancelado',
      pending:    'pendiente'
    };
    const estadoInterno = estadoMap[sub.status] || 'inactivo';

    // ── Verificar si es flujo público (pendientes_suscripcion) ──
    const pendienteSnap = await db.collection('pendientes_suscripcion').doc(externalRef).get();

    const tieneMetodoPago = sub.payment_method_id || sub.card_id;
    if (pendienteSnap.exists && ['authorized', 'pending'].includes(sub.status) && tieneMetodoPago) {
      // ── FLUJO PÚBLICO: crear cuenta nueva ──
      const pendiente = pendienteSnap.data();
      if (pendiente.estado === 'completado') {
        // Ya fue procesado, solo actualizar membresia
        const clientesSnap = await db.collection('clientes').where('email', '==', pendiente.email).limit(1).get();
        if (!clientesSnap.empty) {
          const clienteDoc = clientesSnap.docs[0];
          const update = {
            'membresia.estado': estadoInterno,
            'membresia.mpSubscriptionId': subscriptionId,
            'membresia.mpEstado': sub.status,
            'membresia.actualizadoEn': FieldValue.serverTimestamp(),
            'productos.embi': (pendiente.plan || 'base') === 'pro' ? 'operativo' : 'explicativo',
            'plan': pendiente.plan || 'base'
          };
          if (sub.next_payment_date) update['membresia.proximoCobro'] = new Date(sub.next_payment_date);
          await clienteDoc.ref.update(update);
        }
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Ya procesado' }) };
      }

      try {
        // 1. Generar contraseña temporal
        const password = generarPassword();

        // 2. Crear usuario en Firebase Auth (o recuperar existente)
        let userRecord;
        try {
          userRecord = await auth.createUser({
            email: pendiente.email,
            password: password,
            displayName: pendiente.nombre
          });
        } catch(authError) {
          if (authError.code === 'auth/email-already-exists') {
            userRecord = await auth.getUserByEmail(pendiente.email);
            await auth.updateUser(userRecord.uid, { password: password });
          } else {
            throw authError;
          }
        }

        // 3. Calcular trial end
        const plan = pendiente.plan || 'base';
        let trialEnd = '';
        if (plan === 'base') {
          const trialDate = new Date();
          trialDate.setDate(trialDate.getDate() + 7);
          trialEnd = formatTrialEnd(trialDate);
        }

        // 4. Crear documento en Firestore
        await db.collection('clientes').doc(userRecord.uid).set({
          email: pendiente.email,
          nombre: pendiente.nombre,
          negocioNombre: pendiente.negocioNombre || '',
          uid: userRecord.uid,
          creadoEn: FieldValue.serverTimestamp(),
          primerLogin: true,
          plan: plan,
          productos: {
            sistema: true,
            academia: false,
            embi: plan === 'pro' ? 'operativo' : 'explicativo'
          },
          membresia: {
            plan: plan,
            estado: sub.status === 'authorized' ? (plan === 'base' ? 'trial' : 'activo') : 'pendiente',
            activoDesde: FieldValue.serverTimestamp(),
            mpSubscriptionId: subscriptionId,
            mpEstado: sub.status,
            proximoCobro: sub.next_payment_date ? new Date(sub.next_payment_date) : null
          }
        });

        // 5. Enviar email de bienvenida
        await enviarWelcomeEmail({
          email: pendiente.email,
          nombre: pendiente.nombre,
          negocioNombre: pendiente.negocioNombre || 'tu negocio',
          password,
          plan,
          trialEnd
        });

        // 6. Notificar Pushover
        const monto = sub.auto_recurring?.transaction_amount
          ? `$${sub.auto_recurring.transaction_amount}`
          : '—';
        await notificarPushover({ nombreCliente: pendiente.nombre, email: pendiente.email, plan, monto });

        // 7. Actualizar pendiente
        await pendienteSnap.ref.update({
          estado: 'completado',
          uid: userRecord.uid,
          completadoEn: FieldValue.serverTimestamp()
        });

        console.log(`Nuevo cliente creado: ${pendiente.email} (${userRecord.uid}) — Plan ${plan}`);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Cliente creado' }) };

      } catch (createErr) {
        console.error('Error creando cliente desde pendiente:', createErr);
        await pendienteSnap.ref.update({ estado: 'error', error: createErr.message });
        return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error creando cuenta' }) };
      }
    } else if (pendienteSnap.exists) {
      // Pendiente existe pero no autorizado aún — no caer al flujo interno
      console.log(`Pendiente ${externalRef} existe, estado MP: ${sub.status} — esperando autorización`);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Pendiente existe, esperando autorización' }) };
    }

    // ── FLUJO INTERNO (cliente existente) ──
    let proximoCobro = null;
    if (sub.next_payment_date) {
      proximoCobro = new Date(sub.next_payment_date);
    }
    const update = {
      'membresia.estado': estadoInterno,
      'membresia.mpSubscriptionId': subscriptionId,
      'membresia.mpEstado': sub.status,
      'membresia.actualizadoEn': FieldValue.serverTimestamp()
    };
    try {
      const existSnap = await db.collection('clientes').doc(externalRef).get();
      if (existSnap.exists) {
        const planActual = existSnap.data().membresia?.plan;
        if (planActual) update['plan'] = planActual;
      }
    } catch(e) { console.warn('No se pudo leer plan del cliente:', e.message); }
    if (proximoCobro) update['membresia.proximoCobro'] = proximoCobro;
    if (sub.status === 'authorized') update['membresia.activoDesde'] = FieldValue.serverTimestamp();
    if (sub.status === 'cancelled') update['membresia.canceladoEn'] = FieldValue.serverTimestamp();

    try {
      await db.collection('clientes').doc(externalRef).set(update, { merge: true });
      console.log(`Cliente ${externalRef} → membresia.estado: ${estadoInterno}`);
    } catch (updateErr) {
      // Podría ser un pendiente no-authorized, ignorar
      console.warn(`No se pudo actualizar cliente ${externalRef}:`, updateErr.message);
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Error mp-webhook:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
