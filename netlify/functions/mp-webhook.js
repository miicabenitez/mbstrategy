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
const { PLAN_SERVER, TRIAL_DIAS, normalizarPlan } = require('./_planConfig');
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
    headers: { 'x-internal-secret': process.env.INTERNAL_SECRET || '' },
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

async function pushoverMsg(title, message) {
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: process.env.PUSHOVER_TOKEN, user: process.env.PUSHOVER_USER, title, message, priority: 0 })
    });
  } catch (e) { console.error('Error Pushover:', e); }
}

async function enviarPagoEmail(tipo, data) {
  try {
    const { handler } = require('./send-pago-email');
    await handler({ httpMethod: 'POST', headers: { 'x-internal-secret': process.env.INTERNAL_SECRET || '' }, body: JSON.stringify({ tipo, ...data }) });
  } catch (e) { console.error('Error enviando pago email:', e); }
}

async function findClienteByPreapproval(preapprovalId) {
  const snap = await db.collection('clientes').where('membresia.mpSubscriptionId', '==', preapprovalId).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

async function manejarAuthorizedPayment(payId) {
  const r = await fetch(`https://api.mercadopago.com/authorized_payments/${payId}`, { headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  const ap = await r.json();
  if (!r.ok) { console.error('authorized_payment fetch error:', JSON.stringify(ap)); return; }
  const preapprovalId = ap.preapproval_id;
  if (!preapprovalId) { console.warn('authorized_payment sin preapproval_id'); return; }
  const doc = await findClienteByPreapproval(preapprovalId);
  if (!doc) { console.warn('authorized_payment sin cliente para preapproval', preapprovalId); return; }
  const c = doc.data();
  const pago = ap.payment || {};
  const exito = ap.status === 'processed' || pago.status === 'approved';
  const monto = ap.transaction_amount || pago.transaction_amount || null;
  try {
    await doc.ref.collection('pagosMP').add({
      tipoEvento: 'authorized_payment', authorizedPaymentId: String(payId),
      estado: exito ? 'aprobado' : 'rechazado', monto,
      mpStatus: ap.status || null, mpDetail: pago.status_detail || null,
      fecha: FieldValue.serverTimestamp()
    });
  } catch (e) { console.error('Error log pagosMP:', e); }
  if (exito) {
    const veniaDeFallo = !!(c.membresia?.pagoFalladoEn || c.membresia?.accesoBloqueado);
    const upd = {
      'membresia.estado': 'activo', 'membresia.mpEstado': 'authorized',
      'membresia.accesoBloqueado': false, 'membresia.pagoFalladoEn': FieldValue.delete(),
      'membresia.actualizadoEn': FieldValue.serverTimestamp()
    };
    if (ap.next_payment_date) upd['membresia.proximoCobro'] = new Date(ap.next_payment_date);
    await doc.ref.update(upd);
    if (veniaDeFallo) {
      await pushoverMsg('✅ Pago recuperado', `${c.negocioNombre || c.nombre || '—'} (${c.email || ''})`);
      await enviarPagoEmail('reactivado', { email: c.email, nombre: c.nombre, negocioNombre: c.negocioNombre });
    }
  } else {
    if (!c.membresia?.pagoFalladoEn) {
      await doc.ref.update({ 'membresia.pagoFalladoEn': FieldValue.serverTimestamp(), 'membresia.mpEstado': 'past_due', 'membresia.actualizadoEn': FieldValue.serverTimestamp() });
      await pushoverMsg('⚠️ Pago fallido', `${c.negocioNombre || c.nombre || '—'} (${c.email || ''}) · plan ${c.membresia?.plan || '—'}`);
      await enviarPagoEmail('fallido', { email: c.email, nombre: c.nombre, negocioNombre: c.negocioNombre });
    }
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

    if (type === 'subscription_authorized_payment') {
      const payId = data?.id;
      if (payId) await manejarAuthorizedPayment(payId);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'authorized_payment procesado' }) };
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
    let sub = null;
    try { sub = await mpRes.json(); } catch (_) { sub = null; }
    console.log('SUB COMPLETO:', JSON.stringify(sub));
    // Preapproval inexistente (ej. simulación con Data ID fantasma), inaccesible o sin status → ignorar limpio.
    // Nunca 5xx: MP interpretaría un bug nuestro y reintentaría el mismo evento por horas.
    if (!mpRes.ok || !sub || !sub.status) {
      console.warn(`[mp-webhook] preapproval ${subscriptionId} inexistente o sin status (MP ${mpRes.status}) — ignorado`);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ignored: true, reason: 'preapproval inexistente o inaccesible en MP' }) };
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
      pending:    'pendiente',
      failed:     'inactivo',
      past_due:   'inactivo'
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
            'productos.embi': PLAN_SERVER[normalizarPlan(pendiente.plan)].embi,
            'plan': normalizarPlan(pendiente.plan)
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
        const plan = normalizarPlan(pendiente.plan);
        let trialEnd = '';
        if (PLAN_SERVER[plan].trial) {
          const trialDate = new Date();
          trialDate.setDate(trialDate.getDate() + TRIAL_DIAS);
          trialEnd = formatTrialEnd(trialDate);
        }

        // 4. Crear documento en Firestore con negocioId secuencial (MB-N).
        //    El counter (config/negocioCounter.ultimoId) se incrementa en la MISMA transacción
        //    que crea el cliente: o la cuenta nace con negocioId o no nace (nunca una cuenta sin
        //    negocioId, que es lo que rompía Equipo). La transacción serializa el correlativo
        //    aunque entren dos altas a la vez. Mismo contrato que la migración one-shot.
        const clienteRef = db.collection('clientes').doc(userRecord.uid);
        const counterRef = db.collection('config').doc('negocioCounter');
        const negocioId = await db.runTransaction(async (tx) => {
          const counterSnap = await tx.get(counterRef);
          if (!counterSnap.exists) throw new Error('config/negocioCounter no existe');
          const ultimoId = parseInt(counterSnap.data().ultimoId, 10);
          if (isNaN(ultimoId)) throw new Error('config/negocioCounter.ultimoId no es un número válido');
          const nid = `MB-${ultimoId + 1}`;
          tx.set(clienteRef, {
            email: pendiente.email,
            nombre: pendiente.nombre,
            negocioNombre: pendiente.negocioNombre || '',
            negocioId: nid,
            uid: userRecord.uid,
            creadoEn: FieldValue.serverTimestamp(),
            primerLogin: true,
            plan: plan,
            productos: {
              sistema: true,
              academia: false,
              embi: PLAN_SERVER[plan].embi
            },
            membresia: {
              plan: plan,
              estado: sub.status === 'authorized' ? (PLAN_SERVER[plan].trial ? 'trial' : 'activo') : 'pendiente',
              activoDesde: FieldValue.serverTimestamp(),
              trialUsado: pendiente.freeTrial === true,
              mpSubscriptionId: subscriptionId,
              mpEstado: sub.status,
              proximoCobro: sub.next_payment_date ? new Date(sub.next_payment_date) : null
            }
          });
          tx.update(counterRef, { ultimoId: ultimoId + 1 });
          return nid;
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

        console.log(`Nuevo cliente creado: ${pendiente.email} (${userRecord.uid}) — ${negocioId} — Plan ${plan}`);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Cliente creado' }) };

      } catch (createErr) {
        console.error('[mp-webhook] Error creando cliente desde pendiente (revisar manual):', createErr && createErr.stack ? createErr.stack : createErr);
        try { await pendienteSnap.ref.update({ estado: 'error', error: createErr.message || String(createErr) }); } catch (_) {}
        try { await pushoverMsg('🚨 Alta con error', `${pendiente.email || ''} · plan ${pendiente.plan || '—'} — revisar pendiente ${externalRef}`); } catch (_) {}
        // 200 a propósito: el pendiente queda 'error' para recuperación manual; un 5xx haría reintentar a MP sin efecto (la dedup ya bloquea).
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ignored: true, reason: 'error creando cuenta (pendiente marcado, revisar manual)' }) };
      }
    } else if (pendienteSnap.exists) {
      // Pendiente existe pero no autorizado aún — no caer al flujo interno
      console.log(`Pendiente ${externalRef} existe, estado MP: ${sub.status} — esperando autorización`);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Pendiente existe, esperando autorización' }) };
    }

    // ── FLUJO INTERNO (cliente existente) ──
    const existSnap = await db.collection('clientes').doc(externalRef).get();
    if (!existSnap.exists) {
      console.warn(`Cliente ${externalRef} no existe (posible pendiente no-authorized)`);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Cliente inexistente' }) };
    }
    const cActual = existSnap.data();
    // Guard anti-race: solo procesar la suscripción vigente (ignora webhooks de un preapproval viejo ya reemplazado)
    const subVigente = cActual.membresia?.mpSubscriptionId;
    if (subVigente && subVigente !== subscriptionId) {
      console.log(`Webhook de preapproval viejo ${subscriptionId} ignorado (vigente: ${subVigente})`);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, msg: 'Suscripción no vigente' }) };
    }
    const proximoCobro = sub.next_payment_date ? new Date(sub.next_payment_date) : null;
    // 'paused' es el estado real de MP cuando fallan los cobros → arranca la gracia (el gate bloquea a los 3 días)
    const entraEnFallo = sub.status === 'paused' || ['failed', 'past_due'].includes(sub.status);
    const antesEnFallo = !!(cActual.membresia?.pagoFalladoEn || cActual.membresia?.accesoBloqueado);
    const update = {
      'membresia.estado': estadoInterno,
      'membresia.mpSubscriptionId': subscriptionId,
      'membresia.mpEstado': sub.status,
      'membresia.actualizadoEn': FieldValue.serverTimestamp()
    };
    const planActual = cActual.membresia?.plan;
    if (planActual) update['plan'] = normalizarPlan(planActual);
    if (proximoCobro) update['membresia.proximoCobro'] = proximoCobro;
    if (sub.status === 'authorized') {
      update['membresia.activoDesde'] = FieldValue.serverTimestamp();
      update['membresia.accesoBloqueado'] = false;
      update['membresia.pagoFalladoEn'] = FieldValue.delete();
    }
    if (sub.status === 'cancelled') update['membresia.canceladoEn'] = FieldValue.serverTimestamp();
    if (entraEnFallo && !cActual.membresia?.pagoFalladoEn) update['membresia.pagoFalladoEn'] = FieldValue.serverTimestamp();

    try {
      await existSnap.ref.update(update);
      console.log(`Cliente ${externalRef} → membresia.estado: ${estadoInterno}`);
    } catch (updateErr) {
      console.warn(`No se pudo actualizar cliente ${externalRef}:`, updateErr.message);
    }

    // Notificaciones (una vez por transición)
    if (entraEnFallo && !cActual.membresia?.pagoFalladoEn) {
      await pushoverMsg('⚠️ Pago fallido', `${cActual.negocioNombre || cActual.nombre || '—'} (${cActual.email || ''}) · plan ${cActual.membresia?.plan || '—'}`);
      await enviarPagoEmail('fallido', { email: cActual.email, nombre: cActual.nombre, negocioNombre: cActual.negocioNombre });
    } else if (sub.status === 'authorized' && antesEnFallo) {
      await pushoverMsg('✅ Pago recuperado', `${cActual.negocioNombre || cActual.nombre || '—'} (${cActual.email || ''})`);
      await enviarPagoEmail('reactivado', { email: cActual.email, nombre: cActual.nombre, negocioNombre: cActual.negocioNombre });
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    // Robustez: cualquier excepción no prevista se loguea pero devolvemos 200. Un 5xx haría que MP
    // reintente el mismo evento por horas por un bug nuestro. La dedup por x-request-id ya evita
    // reprocesar si el error fue transitorio y MP reintenta igual.
    console.error('[mp-webhook] excepción no prevista:', err && err.stack ? err.stack : err);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ignored: true, reason: 'error interno (ver logs)' }) };
  }
};
