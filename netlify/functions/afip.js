'use strict';
const admin = require('firebase-admin');
const { Wsaa, Wsfe } = require('afipjs');

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

// ── Rate limiting: máx 50 facturas por cliente por día ──
async function checkRateLimit(uid) {
  const hoy = new Date();
  const diaStr = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
  const ref = db.collection('afipRateLimit').doc(`${uid}_${diaStr}`);
  const snap = await ref.get();
  const count = snap.exists ? snap.data().count : 0;
  if (count >= 50) return false;
  await ref.set({ count: count + 1, uid, dia: diaStr }, { merge: true });
  return true;
}

// ── Helper: fecha YYYYMMDD ──
function fechaAfip(date) {
  const d = date || new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

// ── TA cache en Firestore (config/afipTA) — persiste entre cold starts ──
async function getValidTA(wsaa) {
  const taRef = db.collection('config').doc('afipTA');
  const taSnap = await taRef.get();
  if (taSnap.exists) {
    const saved = taSnap.data();
    if (saved.expirationTime && saved.TA) {
      const expiration = new Date(saved.expirationTime);
      // 10 min de buffer antes del vencimiento
      if (expiration > new Date(Date.now() + 10 * 60 * 1000)) {
        return wsaa.createTAFromString(saved.TA);
      }
    }
  }
  // TA vencido o inexistente — re-autenticar contra WSAA
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

// ── Helper: chequea si AFIP devolvió Errors.Err en el response ──
// methodOrKeys: string (se le agrega 'Result') o array de keys completas (incluyendo 'Result').
// Si el error es por token expirado, borra el TA cacheado en Firestore (fire-and-forget).
function checkAfipErrors(response, methodOrKeys) {
  const keys = Array.isArray(methodOrKeys) ? methodOrKeys : [methodOrKeys + 'Result'];
  for (const key of keys) {
    const result = response[key];
    if (result && result.Errors && result.Errors.Err) {
      const errors = Array.isArray(result.Errors.Err) ? result.Errors.Err : [result.Errors.Err];
      const isTokenError = errors.some(e => e.Code === 600 || /token/i.test(e.Msg || ''));
      if (isTokenError) {
        db.collection('config').doc('afipTA').delete().catch(() => {});
      }
      return errors.map(e => ({ code: e.Code, msg: e.Msg }));
    }
  }
  return null;
}

// ── Helper: extrae detalle de respuesta FECAESolicitar ──
function extractFECAEDetail(result) {
  const detResp = result.FECAESolicitarResult.FeDetResp;
  return Array.isArray(detResp.FECAEDetResponse) ? detResp.FECAEDetResponse[0] : detResp.FECAEDetResponse;
}

// ── Helper: lee result de FECompUltimoAutorizado tolerando typo en response key ──
// La doc README muestra 'FECompUltimoAutozizadoResult' (typo "zi"), pero el WSDL oficial
// usa 'FECompUltimoAutorizadoResult'. Manejamos ambos por las dudas.
function getUltimoAutorizadoResult(resp) {
  return resp.FECompUltimoAutorizadoResult || resp.FECompUltimoAutozizadoResult || {};
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
    // ── Auth: validar Firebase ID token ──
    const authHeader = event.headers?.authorization || '';
    const idToken = authHeader.replace('Bearer ', '');
    if (!idToken) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'No autorizado' }) };
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // ── Parsear body ──
    const body = JSON.parse(event.body || '{}');
    const { accion } = body;
    if (!accion) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Falta accion' }) };

    // ── Verificar que el cliente existe y está activo en Firestore ──
    const clienteSnap = await db.collection('clientes').doc(uid).get();
    if (!clienteSnap.exists) return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Cliente no encontrado' }) };
    const clienteData = clienteSnap.data();
    if (clienteData.estado === 'inactivo' || clienteData.estado === 'suspendido') {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Cuenta inactiva' }) };
    }

    // ── Leer cert y key desde Firestore (no env vars por límite 4KB Lambda) ──
    const afipConfigSnap = await db.collection('config').doc('afip').get();
    if (!afipConfigSnap.exists) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Configuración AFIP no encontrada' }) };
    }
    const afipConfig = afipConfigSnap.data();

    // ── Instanciar Wsaa con cert/key, obtener TA (cache Firestore o nuevo), instanciar Wsfe ──
    const wsaa = new Wsaa({ prod: process.env.AFIP_PRODUCTION === 'true' });
    wsaa.setCertificate(afipConfig.cert);
    wsaa.setKey(afipConfig.key);
    const ta = await getValidTA(wsaa);
    const wsfe = new Wsfe(ta, { prod: process.env.AFIP_PRODUCTION === 'true' });
    const ambiente = process.env.AFIP_PRODUCTION === 'true' ? 'produccion' : 'homologacion';

    // ════════════════════════════════════════
    // ACCIÓN: emitirFactura
    // ════════════════════════════════════════
    if (accion === 'emitirFactura') {
      const {
        puntoVenta, tipoComprobante, importeTotal,
        concepto, cuitReceptor, razonSocialReceptor,
        fechaServDesde, fechaServHasta, fechaVtoPago,
        descripcion
      } = body;

      // Validaciones básicas
      if (!puntoVenta || !tipoComprobante || !importeTotal) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan datos obligatorios: puntoVenta, tipoComprobante, importeTotal' }) };
      }
      if (importeTotal <= 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'El importe debe ser mayor a 0' }) };
      }

      // Rate limiting
      const permitido = await checkRateLimit(uid);
      if (!permitido) {
        return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ error: 'Límite diario de facturas alcanzado (50/día)' }) };
      }

      // Obtener último número (response key tolerante al typo de la doc)
      const lastResp = await wsfe.FECompUltimoAutorizado({
        PtoVta: puntoVenta,
        CbteTipo: tipoComprobante
      });
      const lastErrors = checkAfipErrors(lastResp, ['FECompUltimoAutorizadoResult', 'FECompUltimoAutozizadoResult']);
      if (lastErrors) {
        return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'AFIP rechazó consulta de último comprobante', afipErrors: lastErrors }) };
      }
      const lastVoucher = getUltimoAutorizadoResult(lastResp).CbteNro || 0;
      const nroComprobante = lastVoucher + 1;
      const fechaHoy = fechaAfip();

      // Construir detalle (estructura anidada de afipjs)
      const detRequest = {
        Concepto: concepto || 2, // 2=Servicios por defecto
        DocTipo: cuitReceptor ? 80 : 99, // 80=CUIT, 99=Consumidor Final
        DocNro: cuitReceptor ? parseInt(cuitReceptor) : 0,
        CbteDesde: nroComprobante,
        CbteHasta: nroComprobante,
        CbteFch: fechaHoy,
        ImpTotal: importeTotal,
        ImpTotConc: 0,
        ImpNeto: importeTotal,
        ImpOpEx: 0,
        ImpTrib: 0,
        ImpIVA: 0,
        MonId: 'PES',
        MonCotiz: 1,
        CondicionIVAReceptorId: cuitReceptor ? (body.condicionIVAReceptor || 1) : 5
      };

      // Servicios (concepto 2 o 3): agregar fechas
      if (concepto === 2 || concepto === 3) {
        detRequest.FchServDesde = fechaServDesde || fechaHoy;
        detRequest.FchServHasta = fechaServHasta || fechaHoy;
        detRequest.FchVtoPago = fechaVtoPago || fechaHoy;
      }

      const factura = {
        FeCAEReq: {
          FeCabReq: { CantReg: 1, PtoVta: puntoVenta, CbteTipo: tipoComprobante },
          FeDetReq: { FECAEDetRequest: detRequest }
        }
      };

      const result = await wsfe.FECAESolicitar(factura);
      const caeErrors = checkAfipErrors(result, 'FECAESolicitar');
      if (caeErrors) {
        return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'AFIP rechazó la factura', afipErrors: caeErrors }) };
      }

      const detail = extractFECAEDetail(result);
      const cae = detail.CAE;
      const caeFchVto = detail.CAEFchVto;
      const resultado = detail.Resultado; // 'A'=aprobado, 'R'=rechazado, 'P'=parcial

      if (resultado !== 'A' || !cae) {
        const obs = detail.Observaciones && detail.Observaciones.Obs;
        const obsArr = obs ? (Array.isArray(obs) ? obs : [obs]) : [];
        return {
          statusCode: 422,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'AFIP no aprobó la factura',
            resultado,
            observaciones: obsArr.map(o => ({ code: o.Code, msg: o.Msg }))
          })
        };
      }

      // Guardar en Firestore
      const facturaRef = db.collection('clientes').doc(uid).collection('facturas').doc();
      const facturaData = {
        id: facturaRef.id,
        uid,
        puntoVenta,
        tipoComprobante,
        nroComprobante,
        cae,
        caeFechaVto: caeFchVto,
        importeTotal,
        concepto,
        cuitReceptor: cuitReceptor || null,
        razonSocialReceptor: razonSocialReceptor || null,
        descripcion: descripcion || null,
        fechaEmision: admin.firestore.FieldValue.serverTimestamp(),
        ambiente,
        estado: 'emitida',
        creadoEn: new Date().toISOString()
      };
      await facturaRef.set(facturaData);

      // Audit log
      await db.collection('afipAuditLog').add({
        uid,
        accion: 'emitirFactura',
        facturaId: facturaRef.id,
        nroComprobante,
        cae,
        importeTotal,
        ambiente,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: event.headers?.['x-forwarded-for'] || 'unknown'
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          cae,
          caeFechaVto: caeFchVto,
          nroComprobante,
          facturaId: facturaRef.id,
          ambiente
        })
      };
    }

    // ════════════════════════════════════════
    // ACCIÓN: emitirNotaCredito
    // ════════════════════════════════════════
    if (accion === 'emitirNotaCredito') {
      const { puntoVenta, tipoNotaCredito, importeTotal, caeOriginal, nroComprobanteOriginal, tipoComprobanteOriginal, cuitReceptor } = body;

      if (!puntoVenta || !tipoNotaCredito || !importeTotal || !caeOriginal) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan datos: puntoVenta, tipoNotaCredito, importeTotal, caeOriginal' }) };
      }

      const permitido = await checkRateLimit(uid);
      if (!permitido) {
        return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ error: 'Límite diario alcanzado' }) };
      }

      const lastResp = await wsfe.FECompUltimoAutorizado({
        PtoVta: puntoVenta,
        CbteTipo: tipoNotaCredito
      });
      const lastErrors = checkAfipErrors(lastResp, ['FECompUltimoAutorizadoResult', 'FECompUltimoAutozizadoResult']);
      if (lastErrors) {
        return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'AFIP rechazó consulta de último comprobante', afipErrors: lastErrors }) };
      }
      const lastVoucher = getUltimoAutorizadoResult(lastResp).CbteNro || 0;
      const nroComprobante = lastVoucher + 1;
      const fechaHoy = fechaAfip();

      const ncDetRequest = {
        Concepto: 2,
        DocTipo: cuitReceptor ? 80 : 99,
        DocNro: cuitReceptor ? parseInt(cuitReceptor) : 0,
        CbteDesde: nroComprobante,
        CbteHasta: nroComprobante,
        CbteFch: fechaHoy,
        ImpTotal: importeTotal,
        ImpTotConc: 0,
        ImpNeto: importeTotal,
        ImpOpEx: 0,
        ImpTrib: 0,
        ImpIVA: 0,
        MonId: 'PES',
        MonCotiz: 1,
        CondicionIVAReceptorId: cuitReceptor ? (body.condicionIVAReceptor || 1) : 5,
        FchServDesde: fechaHoy,
        FchServHasta: fechaHoy,
        FchVtoPago: fechaHoy,
        CbtesAsoc: {
          CbteAsoc: [{
            Tipo: tipoComprobanteOriginal,
            PtoVta: puntoVenta,
            Nro: nroComprobanteOriginal,
            Cuit: parseInt(process.env.AFIP_CUIT)
          }]
        }
      };

      const ncFactura = {
        FeCAEReq: {
          FeCabReq: { CantReg: 1, PtoVta: puntoVenta, CbteTipo: tipoNotaCredito },
          FeDetReq: { FECAEDetRequest: ncDetRequest }
        }
      };

      const result = await wsfe.FECAESolicitar(ncFactura);
      const caeErrors = checkAfipErrors(result, 'FECAESolicitar');
      if (caeErrors) {
        return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'AFIP rechazó la nota de crédito', afipErrors: caeErrors }) };
      }

      const detail = extractFECAEDetail(result);
      const cae = detail.CAE;
      const caeFchVto = detail.CAEFchVto;
      const resultado = detail.Resultado;

      if (resultado !== 'A' || !cae) {
        const obs = detail.Observaciones && detail.Observaciones.Obs;
        const obsArr = obs ? (Array.isArray(obs) ? obs : [obs]) : [];
        return {
          statusCode: 422,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'AFIP no aprobó la nota de crédito',
            resultado,
            observaciones: obsArr.map(o => ({ code: o.Code, msg: o.Msg }))
          })
        };
      }

      const ncRef = db.collection('clientes').doc(uid).collection('notasCredito').doc();
      await ncRef.set({
        id: ncRef.id,
        uid,
        puntoVenta,
        tipoNotaCredito,
        nroComprobante,
        cae,
        caeFechaVto: caeFchVto,
        importeTotal,
        caeOriginal,
        nroComprobanteOriginal,
        fechaEmision: admin.firestore.FieldValue.serverTimestamp(),
        ambiente,
        estado: 'emitida',
        creadoEn: new Date().toISOString()
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, cae, caeFechaVto: caeFchVto, nroComprobante, ncId: ncRef.id })
      };
    }

    // ════════════════════════════════════════
    // ACCIÓN: ultimoComprobante
    // ════════════════════════════════════════
    if (accion === 'ultimoComprobante') {
      const { puntoVenta, tipoComprobante } = body;
      if (!puntoVenta || !tipoComprobante) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan puntoVenta y tipoComprobante' }) };
      }
      const lastResp = await wsfe.FECompUltimoAutorizado({
        PtoVta: puntoVenta,
        CbteTipo: tipoComprobante
      });
      const lastErrors = checkAfipErrors(lastResp, ['FECompUltimoAutorizadoResult', 'FECompUltimoAutozizadoResult']);
      if (lastErrors) {
        return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'AFIP rechazó la consulta', afipErrors: lastErrors }) };
      }
      const ultimo = getUltimoAutorizadoResult(lastResp).CbteNro || 0;
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, ultimo, siguiente: ultimo + 1 }) };
    }

    // ════════════════════════════════════════
    // ACCIÓN: listarFacturas
    // ════════════════════════════════════════
    if (accion === 'listarFacturas') {
      const snap = await db.collection('clientes').doc(uid).collection('facturas')
        .orderBy('creadoEn', 'desc').limit(100).get();
      const facturas = snap.docs.map(d => d.data());
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, facturas }) };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Acción no reconocida: ' + accion }) };

  } catch (err) {
    console.error('AFIP Function Error:', err);
    // Log de error en Firestore
    try {
      await db.collection('afipErrorLog').add({
        error: err.message,
        stack: err.stack?.substring(0, 500),
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch(e) { /* silent */ }
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Error interno. Código: ' + (err.code || 'UNKNOWN') })
    };
  }
};
