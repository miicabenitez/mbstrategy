'use strict';
const admin = require('firebase-admin');

// ── Firebase Admin singleton ──
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();

// ── CORS ──
const ALLOWED_ORIGINS = [
  'https://sistema.mbstrategy.com.ar',
  'https://dev--creative-griffin-98f177.netlify.app'
];
function getCorsHeaders(event) {
  const origin = event.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cliente-UID',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

exports.handler = async function(event) {
  const corsHeaders = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  try {
    // ── Auth: verificar Firebase ID token ──
    const authHeader = event.headers?.authorization || '';
    const idToken = authHeader.replace('Bearer ', '');
    if (!idToken) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'No autorizado' }) };
    const decoded = await admin.auth().verifyIdToken(idToken);
    const callerUid = decoded.uid;
    const clienteUID = event.headers?.['x-cliente-uid'] || '';
    if (!clienteUID) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Falta X-Cliente-UID' }) };

    // ── Verificar que el caller es el dueño del negocio ──
    const clienteSnap = await db.collection('clientes').doc(clienteUID).get();
    if (!clienteSnap.exists) return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Negocio no encontrado' }) };
    const clienteData = clienteSnap.data();
    if (clienteData.uid !== callerUid) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Solo el admin del negocio puede gestionar usuarios' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { accion } = body;

    // ── ACCIÓN: crear operador ────────────────────────────────
    if (accion === 'crear') {
      const { nombre, usuario: usuarioRaw, password, rol } = body;
      if (!nombre || !usuarioRaw || !password || !rol) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos: nombre, usuario, password, rol' }) };
      }
      const usuario = usuarioRaw.toLowerCase().trim();
      const ROLES_VALIDOS = ['cajero', 'compras', 'comercial', 'vendedor'];
      if (!ROLES_VALIDOS.includes(rol)) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Rol inválido. Debe ser uno de: ${ROLES_VALIDOS.join(', ')}` }) };
      }
      if (/\s|@/.test(usuario)) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'El usuario no puede tener espacios ni @' }) };
      }
      if (password.length < 6) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'La contraseña debe tener al menos 6 caracteres' }) };
      }

      const emailSintetico = `${usuario}@${clienteUID}.op.mbstrategy.internal`;

      // Verificar que el usuario no exista ya en operadoresLookup
      const lookupSnap = await db.collection('operadoresLookup').doc(usuario).get();
      if (lookupSnap.exists) {
        return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: `El usuario "${usuario}" ya existe` }) };
      }

      // Crear en Firebase Auth
      const userRecord = await admin.auth().createUser({
        email: emailSintetico,
        password,
        displayName: nombre
      });
      const newUid = userRecord.uid;

      // Guardar en clientes/{clienteUID}/operadores/{newUid}
      await db.collection('clientes').doc(clienteUID).collection('operadores').doc(newUid).set({
        uid: newUid,
        usuario,
        nombre,
        rol,
        emailSintetico,
        activo: true,
        creadoEn: new Date().toISOString()
      });

      // Guardar en operadoresLookup/{usuario} para login lookup O(1)
      await db.collection('operadoresLookup').doc(usuario).set({
        emailSintetico,
        clienteUID
      });

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, uid: newUid }) };
    }

    // ── ACCIÓN: desactivar operador ───────────────────────────
    if (accion === 'desactivar') {
      const { docId, usuario: usuarioRawD, uid: opUid } = body;
      const usuario = usuarioRawD ? usuarioRawD.toLowerCase().trim() : '';
      if (!docId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Falta docId' }) };

      // Marcar como inactivo en Firestore
      await db.collection('clientes').doc(clienteUID).collection('operadores').doc(docId).update({
        activo: false,
        desactivadoEn: new Date().toISOString()
      });

      // Eliminar de operadoresLookup para que no pueda hacer login
      if (usuario) {
        await db.collection('operadoresLookup').doc(usuario).delete().catch(() => {});
      }

      // Deshabilitar en Firebase Auth
      if (opUid) {
        await admin.auth().updateUser(opUid, { disabled: true }).catch(() => {});
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }

    // ── ACCIÓN: eliminar operador ─────────────────────────────
    if (accion === 'eliminar') {
      const { docId, usuario: usuarioRawE, uid: opUid } = body;
      const usuario = usuarioRawE ? usuarioRawE.toLowerCase().trim() : '';
      if (!docId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Falta docId' }) };

      // Eliminar doc de operadores
      await db.collection('clientes').doc(clienteUID).collection('operadores').doc(docId).delete().catch(() => {});

      // Eliminar de operadoresLookup
      if (usuario) {
        await db.collection('operadoresLookup').doc(usuario).delete().catch(() => {});
      }

      // Eliminar de Firebase Auth
      if (opUid) {
        await admin.auth().deleteUser(opUid).catch(() => {});
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Acción no reconocida' }) };

  } catch(e) {
    console.error('create-operator error:', e);
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: e.message || 'Error interno' }) };
  }
};
