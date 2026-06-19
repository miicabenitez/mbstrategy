// netlify/functions/_auth.js — helpers de autenticación/ownership compartidos (espejo de _planConfig.js).
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();

// Verifica el Firebase ID token del caller. Devuelve { uid, email } o { error, statusCode }.
async function verifyAuth(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const idToken = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  if (!idToken) return { error: 'No autorizado', statusCode: 401 };
  try {
    const d = await admin.auth().verifyIdToken(idToken);
    return { uid: d.uid, email: d.email || null };
  } catch (e) {
    return { error: 'Token inválido', statusCode: 401 };
  }
}

// Valida que uid sea el dueño del cliente o un operador suyo (cajero/comercial/etc.).
// Devuelve { ok, data, rol } o { error, statusCode }.
async function requireOwner(database, uid, clienteUID) {
  if (!clienteUID) return { error: 'Falta clienteUID', statusCode: 400 };
  try {
    const snap = await database.collection('clientes').doc(clienteUID).get();
    if (!snap.exists) return { error: 'Negocio no encontrado', statusCode: 403 };
    const data = snap.data();
    if (data.uid === uid) return { ok: true, data, rol: 'dueno' };
    const op = await database.collection('clientes').doc(clienteUID).collection('operadores').doc(uid).get();
    if (op.exists) return { ok: true, data, rol: 'operador' };
    return { error: 'No autorizado para este negocio', statusCode: 403 };
  } catch (e) {
    return { error: 'Error de verificación', statusCode: 500 };
  }
}

module.exports = { admin, db, verifyAuth, requireOwner };
