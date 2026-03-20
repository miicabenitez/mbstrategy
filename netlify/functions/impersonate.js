const admin = require('firebase-admin');

let app;
function getApp() {
  if (!app) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  return app;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { uid, adminSecret } = JSON.parse(event.body || '{}');
  if (!uid) {
    return { statusCode: 400, body: JSON.stringify({ error: 'UID requerido' }) };
  }
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
  }
  try {
    getApp();
    const customToken = await admin.auth().createCustomToken(uid);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
