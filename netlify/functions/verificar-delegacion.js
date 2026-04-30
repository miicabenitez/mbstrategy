'use strict';
const https = require('https');
https.globalAgent.options.ciphers = 'DEFAULT@SECLEVEL=0';
const admin = require('firebase-admin');
const { Wsaa, Wsfe } = require('afipjs');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();

const ALLOWED_ORIGINS = [
  'https://sistema.mbstrategy.com.ar',
  'https://dev--creative-griffin-98f177.netlify.app'
];
function getCorsHeaders(event) {
  const origin = event.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

async function getValidTA(wsaa) {
  const taRef = db.collection('config').doc('afipTA');
  const taSnap = await taRef.get();
  if (taSnap.exists) {
    const saved = taSnap.data();
    if (saved.expirationTime && saved.TA) {
      const expiration = new Date(saved.expirationTime);
      if (expiration > new Date(Date.now() + 10 * 60 * 1000)) {
        return wsaa.createTAFromString(saved.TA);
      }
    }
  }
  const tra = wsaa.createTRA();
  const ta = await tra.supplicateTA();
  await taRef.set({
    TA: ta.TA,
    token: ta.TA_parsed.token,
    sign: ta.TA_parsed.sign,
    cuit: ta.TA_parsed.cuit,
    expirationTime: ta.TA_parsed.expirationTime,
    actualizadoEn: new Date().toISOString()
  });
  return ta;
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
    const authHeader = event.headers?.authorization || '';
    const idToken = authHeader.replace('Bearer ', '');
    if (!idToken) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'No autorizado' }) };
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const body = JSON.parse(event.body || '{}');
    const { negocioCuit, negocioPuntoVenta } = body;
    if (!negocioCuit || !negocioPuntoVenta) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan negocioCuit o negocioPuntoVenta' }) };
    }

    const cuitNum = parseInt(String(negocioCuit).replace(/\D/g, ''));
    const pvNum = parseInt(String(negocioPuntoVenta));
    if (!cuitNum || !pvNum) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'CUIT o punto de venta inválido' }) };
    }

    const afipConfigSnap = await db.collection('config').doc('afip').get();
    if (!afipConfigSnap.exists) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Configuración AFIP no encontrada' }) };
    }
    const afipConfig = afipConfigSnap.data();

    const wsaa = new Wsaa({ prod: process.env.AFIP_PRODUCTION === 'true' });
    wsaa.setCertificate(afipConfig.cert);
    wsaa.setKey(afipConfig.key);
    const ta = await getValidTA(wsaa);

    const wsfe = new Wsfe(ta, { prod: process.env.AFIP_PRODUCTION === 'true' });
    wsfe.hAuth.Auth.Cuit = cuitNum;

    // Verificar delegación: llamada ligera con CUIT del cliente
    let delegado = false;
    try {
      const resp = await wsfe.FECompUltimoAutorizado({ PtoVta: pvNum, CbteTipo: 11 });
      const result = resp.FECompUltimoAutorizadoResult || resp.FECompUltimoAutozizadoResult || {};
      // Sin errores de auth → delegación activa
      if (!result.Errors || !result.Errors.Err) {
        delegado = true;
      }
    } catch (wsfeErr) {
      // Fallo (sin delegación o error de red) → no hacer nada
      delegado = false;
    }

    if (!delegado) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, delegado: false }) };
    }

    // Delegación confirmada: leer nombre para Pushover
    const clienteSnap = await db.collection('clientes').doc(uid).get();
    const d = clienteSnap.exists ? clienteSnap.data() : {};
    const nombre = d.titularNombre || d.negocioNombre || uid;

    // Marcar pendiente de aprobación manual
    await db.collection('clientes').doc(uid).update({ afipAprobado: false });

    // Notificar Pushover
    try {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: process.env.PUSHOVER_TOKEN,
          user: process.env.PUSHOVER_USER,
          title: '🔔 Delegación ARCA verificada',
          message: `🔔 Cliente ${nombre} (${negocioCuit}) delegó ARCA — pendiente tu aprobación en el panel admin`,
          priority: 0
        })
      });
    } catch (e) {
      console.error('Error Pushover:', e);
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, delegado: true }) };

  } catch (err) {
    console.error('verificar-delegacion error:', err);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
