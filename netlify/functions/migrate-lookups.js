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

    // ── 1. Map clienteUID → negocioId ──
    const clientesSnap = await db.collection('clientes').get();
    const negocioIdByCliente = {};
    clientesSnap.forEach(d => {
      const ni = d.data().negocioId;
      if (ni) negocioIdByCliente[d.id] = ni;
    });

    // ── 2. Leer todos los lookups y clasificar ──
    const lookupsSnap = await db.collection('operadoresLookup').get();
    const yaMigrados = [];
    const migrados = [];
    const omitidos = [];
    const ops = [];

    lookupsSnap.forEach(d => {
      const docId = d.id;
      const data = d.data();
      // Ya migrado: doc ID con prefijo MB-<digits>_
      if (/^MB-\d+_/.test(docId)) {
        yaMigrados.push(docId);
        return;
      }
      const clienteUID = data.clienteUID;
      if (!clienteUID) {
        omitidos.push({ docId, motivo: 'sin clienteUID' });
        return;
      }
      const negocioId = negocioIdByCliente[clienteUID];
      if (!negocioId) {
        omitidos.push({ docId, motivo: `cliente ${clienteUID} sin negocioId` });
        return;
      }
      const newDocId = `${negocioId}_${docId}`;
      ops.push({ oldId: docId, newId: newDocId, data });
      migrados.push({ oldId: docId, newId: newDocId, clienteUID });
    });

    // ── 3. Aplicar en batches (cada op = set new + delete old = 2 writes; tope 500/batch ⇒ 200 ops por batch con headroom) ──
    const BATCH_SIZE = 200;
    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const batch = db.batch();
      ops.slice(i, i + BATCH_SIZE).forEach(op => {
        batch.set(db.collection('operadoresLookup').doc(op.newId), op.data);
        batch.delete(db.collection('operadoresLookup').doc(op.oldId));
      });
      await batch.commit();
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        total: lookupsSnap.size,
        migrados: migrados.length,
        yaMigrados: yaMigrados.length,
        omitidos: omitidos.length,
        detalleMigrados: migrados,
        detalleOmitidos: omitidos
      })
    };
  } catch (e) {
    console.error('migrate-lookups error:', e);
    return { statusCode: 500, headers: getCorsHeaders(event), body: JSON.stringify({ error: e.message || 'Error interno' }) };
  }
};
