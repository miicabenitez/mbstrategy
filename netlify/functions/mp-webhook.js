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
  return expected === parts.v1;
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

    if (pendienteSnap.exists && sub.status === 'authorized') {
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
            'membresia.actualizadoEn': FieldValue.serverTimestamp()
          };
          if (sub.next_payment_date) update['membresia.proximoCobro'] = new Date(sub.next_payment_date);
          await clienteDoc.ref.update(update);
        }
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Ya procesado' }) };
      }

      try {
        // 1. Generar contraseña temporal
        const password = generarPassword();

        // 2. Crear usuario en Firebase Auth
        const userRecord = await auth.createUser({
          email: pendiente.email,
          password: password,
          displayName: pendiente.nombre
        });

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
          productos: {
            sistema: true,
            academia: false,
            embi: plan === 'pro' ? 'operativo' : 'explicativo'
          },
          membresia: {
            plan: plan,
            estado: plan === 'base' ? 'trial' : 'activo',
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

        // 6. Actualizar pendiente
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
    if (proximoCobro) update['membresia.proximoCobro'] = proximoCobro;
    if (sub.status === 'authorized') update['membresia.activoDesde'] = FieldValue.serverTimestamp();
    if (sub.status === 'cancelled') update['membresia.canceladoEn'] = FieldValue.serverTimestamp();

    try {
      await db.collection('clientes').doc(externalRef).update(update);
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
