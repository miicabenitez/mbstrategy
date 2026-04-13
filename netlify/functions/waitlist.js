// netlify/functions/waitlist.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

async function notificarPushover(email) {
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: process.env.PUSHOVER_TOKEN,
        user: process.env.PUSHOVER_USER,
        title: '🚀 Waitlist',
        message: `🚀 Nueva anotación waitlist: ${email}`,
        priority: 0
      })
    });
  } catch (e) {
    console.error('Error notificando Pushover:', e);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Email inválido' }) };
  }

  try {
    await db.collection('waitlist').add({
      email: email.trim().toLowerCase(),
      creadoEn: FieldValue.serverTimestamp(),
      origen: 'planes.html'
    });
    await notificarPushover(email.trim().toLowerCase());
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Error waitlist:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
