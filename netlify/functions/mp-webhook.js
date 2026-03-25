// netlify/functions/mp-webhook.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();
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
    const clienteId = sub.external_reference;
    if (!clienteId) {
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
    await db.collection('clientes').doc(clienteId).update(update);
    console.log(`Cliente ${clienteId} → membresia.estado: ${estadoInterno}`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Error mp-webhook:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
