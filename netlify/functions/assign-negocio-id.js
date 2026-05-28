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
    'Access-Control-Allow-Headers': 'Content-Type, X-Migration-Secret',
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
    // ── Auth: secret de migración ──
    const secret = event.headers?.['x-migration-secret'] || '';
    const expected = process.env.MIGRATION_SECRET || '';
    if (!expected || secret !== expected) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    // ── 1. Listar clientes sin negocioId (fuera de la transacción) ──
    const clientesSnap = await db.collection('clientes').get();
    const sinId = clientesSnap.docs.filter(d => !d.data().negocioId);

    if (sinId.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, mensaje: 'Todos los clientes ya tienen negocioId', total: 0, actualizados: [] })
      };
    }

    // Una transacción de Firestore admite hasta ~500 writes. Reservamos 1 para el counter.
    if (sinId.length > 450) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Demasiados clientes sin ID (${sinId.length}). Procesar en batches de 450.` })
      };
    }

    // ── 2. Transacción: leer counter, asignar IDs, actualizar counter + clientes ──
    const counterRef = db.collection('config').doc('negocioCounter');
    const actualizados = await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      if (!counterSnap.exists) {
        throw new Error('config/negocioCounter no existe. Crearlo primero con { ultimoId: <numero> }.');
      }
      const ultimoId = parseInt(counterSnap.data().ultimoId, 10);
      if (isNaN(ultimoId)) {
        throw new Error('config/negocioCounter.ultimoId no es un número válido.');
      }

      const asignados = [];
      sinId.forEach((doc, i) => {
        const nuevoId = `MB-${ultimoId + i + 1}`;
        tx.update(doc.ref, { negocioId: nuevoId });
        asignados.push({
          uid: doc.id,
          nombre: doc.data().nombre || doc.data().negocioNombre || '',
          negocioId: nuevoId
        });
      });
      tx.update(counterRef, { ultimoId: ultimoId + sinId.length });
      return asignados;
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, total: actualizados.length, actualizados })
    };
  } catch (e) {
    console.error('assign-negocio-id error:', e);
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: e.message || 'Error interno' }) };
  }
};
