// netlify/functions/mp-cancel.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();
const ALLOWED_ORIGINS = ['https://sistema.mbstrategy.com.ar', 'https://dev--creative-griffin-98f177.netlify.app'];

function getCorsHeaders(event) {
  const origin = (event && event.headers && event.headers.origin) || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

async function notificarPushover({ nombreNegocio, email, plan }) {
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: process.env.PUSHOVER_TOKEN,
        user: process.env.PUSHOVER_USER,
        title: '❌ Suscripción cancelada',
        message: `🏢 ${nombreNegocio}\n📧 ${email}\n📦 Plan ${plan}`,
        priority: 0
      })
    });
  } catch (e) {
    console.error('Error notificando Pushover:', e);
  }
}

exports.handler = async (event) => {
  const HEADERS = getCorsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };

  try {
    const { clienteId } = JSON.parse(event.body || '{}');
    if (!clienteId) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'clienteId requerido' }) };
    }

    const clienteSnap = await db.collection('clientes').doc(clienteId).get();
    if (!clienteSnap.exists) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Cliente no encontrado' }) };
    }
    const cliente = clienteSnap.data();
    const mpSubscriptionId = cliente.membresia?.mpSubscriptionId;

    if (!mpSubscriptionId) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'No se encontró ID de suscripción en Mercado Pago' }) };
    }

    // Cancelar en MP
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${mpSubscriptionId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'cancelled' })
    });
    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error('MP cancel error:', JSON.stringify(mpData));
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Error al cancelar en Mercado Pago' }) };
    }

    // Update optimista en Firestore
    await db.collection('clientes').doc(clienteId).update({
      'membresia.estado': 'cancelado',
      'membresia.mpEstado': 'cancelled',
      'membresia.canceladoEn': FieldValue.serverTimestamp(),
      'membresia.actualizadoEn': FieldValue.serverTimestamp()
    });

    // Notificar Pushover
    await notificarPushover({
      nombreNegocio: cliente.negocioNombre || cliente.nombre || 'Sin nombre',
      email: cliente.email || '',
      plan: cliente.membresia?.plan || '—'
    });

    console.log(`Suscripción cancelada: cliente ${clienteId}, MP id ${mpSubscriptionId}`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Error mp-cancel:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error interno del servidor' }) };
  }
};
