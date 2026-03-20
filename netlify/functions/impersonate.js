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

const ADMIN_EMAIL = 'miicabenitez12@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { uid, idToken } = JSON.parse(event.body || '{}');

  if (!uid || !idToken) {
    return { statusCode: 400, body: JSON.stringify({ error: 'uid e idToken requeridos' }) };
  }

  try {
    getApp();

    // Verificar que el token pertenece al admin
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (decoded.email !== ADMIN_EMAIL) {
      return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    // Generar custom token para el cliente
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

