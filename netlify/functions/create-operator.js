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
    const negocioId = clienteData.negocioId;

    const body = JSON.parse(event.body || '{}');
    const { accion } = body;

    // ── ACCIÓN: crear operador ────────────────────────────────
    if (accion === 'crear') {
      const { nombre, usuario: usuarioRaw, password, cajas } = body;
      // COMMIT 3.6.1: acepta payload nuevo (roles[]) o legacy (rol string). Normaliza a array.
      const rolesArr = Array.isArray(body.roles) ? body.roles : (body.rol ? [body.rol] : []);
      if (!nombre || !usuarioRaw || !password || rolesArr.length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos: nombre, usuario, password, roles' }) };
      }
      const usuario = usuarioRaw.toLowerCase().trim();
      const ROLES_VALIDOS = ['cajero', 'compras', 'comercial', 'vendedor', 'produccion'];
      if (!rolesArr.every(r => ROLES_VALIDOS.includes(r))) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Roles inválidos. Cada uno debe ser uno de: ${ROLES_VALIDOS.join(', ')}` }) };
      }
      const tieneCajero = rolesArr.includes('cajero');
      if (/\s|@/.test(usuario)) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'El usuario no puede tener espacios ni @' }) };
      }
      if (password.length < 6) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'La contraseña debe tener al menos 6 caracteres' }) };
      }

      if (!negocioId) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'El negocio no tiene negocioId asignado. Ejecutar la migración primero.' }) };
      }

      // Validación de cajas (solo si tiene rol cajero)
      if (tieneCajero) {
        if (!Array.isArray(cajas) || cajas.length === 0) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Asigná al menos una caja al cajero.' }) };
        }
        const cajasSnap = await db.collection('clientes').doc(clienteUID).collection('cajas').get();
        const cajasMap = {};
        cajasSnap.forEach(d => { cajasMap[d.id] = d.data(); });
        const invalidos = [];
        for (const cid of cajas) {
          const cdata = cajasMap[cid];
          if (!cdata || cdata.activa === false) invalidos.push(cid);
        }
        if (invalidos.length) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Cajas inválidas o inactivas: ${invalidos.join(', ')}` }) };
        }
      }

      const emailSintetico = `${usuario}@${clienteUID}.op.mbstrategy.internal`;

      // Verificar que el usuario no exista ya en operadoresLookup
      const lookupSnap = await db.collection('operadoresLookup').doc(`${negocioId}_${usuario}`).get();
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
      // COMMIT 3.6.1: escribimos roles[] (nuevo) + rol (legacy primario) para que el login viejo siga andando
      await db.collection('clientes').doc(clienteUID).collection('operadores').doc(newUid).set({
        uid: newUid,
        usuario,
        nombre,
        roles: rolesArr,
        rol: tieneCajero ? 'cajero' : rolesArr[0],
        negocioId,
        cajas: tieneCajero ? cajas : [],
        emailSintetico,
        activo: true,
        creadoEn: new Date().toISOString()
      });

      // Guardar en operadoresLookup/{negocioId}_{usuario} para login lookup O(1)
      await db.collection('operadoresLookup').doc(`${negocioId}_${usuario}`).set({
        emailSintetico: emailSintetico.toLowerCase(),
        clienteUID
      });

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, uid: newUid }) };
    }

    // ── ACCIÓN: editar operador ───────────────────────────────
    if (accion === 'editar') {
      const { uid: opUid, nombre, password, cajas } = body;
      // COMMIT 3.6.1: acepta payload nuevo (roles[]) o legacy (rol string). Normaliza a array.
      const rolesArr = Array.isArray(body.roles) ? body.roles : (body.rol ? [body.rol] : []);
      if (!opUid) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Falta uid del operador' }) };
      if (!nombre || rolesArr.length === 0) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos: nombre, roles' }) };
      const ROLES_VALIDOS_EDIT = ['cajero', 'compras', 'comercial', 'vendedor', 'produccion'];
      if (!rolesArr.every(r => ROLES_VALIDOS_EDIT.includes(r))) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Roles inválidos. Cada uno debe ser uno de: ${ROLES_VALIDOS_EDIT.join(', ')}` }) };
      }
      const tieneCajero = rolesArr.includes('cajero');
      if (password && password.length < 6) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'La contraseña debe tener al menos 6 caracteres' }) };
      }

      const opRef = db.collection('clientes').doc(clienteUID).collection('operadores').doc(opUid);
      const opSnap = await opRef.get();
      if (!opSnap.exists) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Operador no encontrado' }) };
      }

      if (tieneCajero) {
        if (!Array.isArray(cajas) || cajas.length === 0) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Asigná al menos una caja al cajero.' }) };
        }
        const cajasSnap = await db.collection('clientes').doc(clienteUID).collection('cajas').get();
        const cajasMap = {};
        cajasSnap.forEach(d => { cajasMap[d.id] = d.data(); });
        const invalidos = [];
        for (const cid of cajas) {
          const cdata = cajasMap[cid];
          if (!cdata || cdata.activa === false) invalidos.push(cid);
        }
        if (invalidos.length) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Cajas inválidas o inactivas: ${invalidos.join(', ')}` }) };
        }
      }

      // COMMIT 3.6.1: actualizamos roles[] (nuevo) + rol (legacy primario)
      await opRef.update({
        nombre,
        roles: rolesArr,
        rol: tieneCajero ? 'cajero' : rolesArr[0],
        cajas: tieneCajero ? cajas : []
      });

      if (password) {
        await admin.auth().updateUser(opUid, { password });
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
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
      if (usuario && negocioId) {
        await db.collection('operadoresLookup').doc(`${negocioId}_${usuario}`).delete().catch(() => {});
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
      if (usuario && negocioId) {
        await db.collection('operadoresLookup').doc(`${negocioId}_${usuario}`).delete().catch(() => {});
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
