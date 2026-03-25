// netlify/functions/mp-subscription.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();
const HEADERS = {
  'Access-Control-Allow-Origin': 'https://sistema.mbstrategy.com.ar',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  try {
    const { clienteId, plan } = JSON.parse(event.body || '{}');
    if (!clienteId || !['base', 'pro'].includes(plan)) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Datos inválidos' }) };
    }
    const configSnap = await db.collection('config').doc('planes').get();
    if (!configSnap.exists) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Configuración de planes no encontrada. Creá el documento config/planes en Firestore.' }) };
    }
    const planData = configSnap.data()[plan];
    if (!planData?.precioPesos) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: `Precio del plan "${plan}" no configurado` }) };
    }
    const clienteSnap = await db.collection('clientes').doc(clienteId).get();
    if (!clienteSnap.exists) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Cliente no encontrado' }) };
    }
    const cliente = clienteSnap.data();
    if (cliente.membresia?.estado === 'activo') {
      return { statusCode: 409, headers: HEADERS, body: JSON.stringify({ error: 'El cliente ya tiene una suscripción activa' }) };
    }
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reason: `MB Strategy — Plan ${plan === 'base' ? 'Base' : 'Pro'}`,
        external_reference: clienteId,
        payer_email: cliente.email,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: planData.precioPesos,
          currency_id: 'ARS'
        },
        back_url: 'https://sistema.mbstrategy.com.ar',
        status: 'pending'
      })
    });
    const mpData = await mpRes.json();
    if (!mpRes.ok || !mpData.init_point) {
      console.error('MP API error:', JSON.stringify(mpData));
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Error al crear suscripción en Mercado Pago' }) };
    }
    await db.collection('clientes').doc(clienteId).update({
      'membresia.plan': plan,
      'membresia.estado': 'pendiente',
      'membresia.mpSubscriptionId': mpData.id,
      'membresia.precioPesos': planData.precioPesos,
      'membresia.precioUSD': planData.precioUSD,
      'membresia.creadoEn': FieldValue.serverTimestamp()
    });
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ init_point: mpData.init_point })
    };
  } catch (err) {
    console.error('Error mp-subscription:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error interno del servidor' }) };
  }
};
