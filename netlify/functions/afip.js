'use strict';
const admin = require('firebase-admin');
const Afip = require('@afipsdk/afip.js');

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

    // ── Inicializar AFIP SDK ──
    const afip = new Afip({
      CUIT: parseInt(process.env.AFIP_CUIT),
      cert: afipConfig.cert,
      key: afipConfig.key,
      production: process.env.AFIP_PRODUCTION === 'true',
      res_folder: '/tmp',
      ta_folder: '/tmp'
    });

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

      // Obtener último número de comprobante
      const lastVoucher = await afip.ElectronicBilling.getLastVoucher(puntoVenta, tipoComprobante);
      const nroComprobante = lastVoucher + 1;
      const fechaHoy = fechaAfip();

      const voucherData = {
        CantReg: 1,
        PtoVta: puntoVenta,
        CbteTipo: tipoComprobante,
        Concepto: concepto || 2, // 2=Servicios por defecto (PyMEs de servicio)
        DocTipo: cuitReceptor ? 80 : 99, // 80=CUIT, 99=Consumidor Final
        DocNro: cuitReceptor ? parseInt(cuitReceptor) : 0,
        CbteDesde: nroComprobante,
        CbteHasta: nroComprobante,
        CbteFch: fechaHoy,
        ImpTotal: importeTotal,
        ImpTotConc: 0,
        ImpNeto: importeTotal,
        ImpOpEx: 0,
        ImpIVA: 0,
        ImpTrib: 0,
        MonId: 'PES',
        MonCotiz: 1,
      };

      // Servicios: agregar fechas
      if (concepto === 2 || concepto === 3) {
        voucherData.FchServDesde = fechaServDesde || fechaHoy;
        voucherData.FchServHasta = fechaServHasta || fechaHoy;
        voucherData.FchVtoPago = fechaVtoPago || fechaHoy;
      }

      const result = await afip.ElectronicBilling.createVoucher(voucherData);

      // Guardar en Firestore con log completo
      const facturaRef = db.collection('clientes').doc(uid).collection('facturas').doc();
      const facturaData = {
        id: facturaRef.id,
        uid,
        puntoVenta,
        tipoComprobante,
        nroComprobante,
        cae: result.CAE,
        caeFechaVto: result.CAEFchVto,
        importeTotal,
        concepto,
        cuitReceptor: cuitReceptor || null,
        razonSocialReceptor: razonSocialReceptor || null,
        descripcion: descripcion || null,
        fechaEmision: admin.firestore.FieldValue.serverTimestamp(),
        ambiente: process.env.AFIP_PRODUCTION === 'true' ? 'produccion' : 'homologacion',
        estado: 'emitida',
        creadoEn: new Date().toISOString()
      };
      await facturaRef.set(facturaData);

      // Log de auditoría separado
      await db.collection('afipAuditLog').add({
        uid,
        accion: 'emitirFactura',
        facturaId: facturaRef.id,
        nroComprobante,
        cae: result.CAE,
        importeTotal,
        ambiente: facturaData.ambiente,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: event.headers?.['x-forwarded-for'] || 'unknown'
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          cae: result.CAE,
          caeFechaVto: result.CAEFchVto,
          nroComprobante,
          facturaId: facturaRef.id,
          ambiente: facturaData.ambiente
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

      const lastVoucher = await afip.ElectronicBilling.getLastVoucher(puntoVenta, tipoNotaCredito);
      const nroComprobante = lastVoucher + 1;
      const fechaHoy = fechaAfip();

      const ncData = {
        CantReg: 1,
        PtoVta: puntoVenta,
        CbteTipo: tipoNotaCredito, // 13=NC C monotributo, 3=NC A RI, 8=NC B RI
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
        ImpIVA: 0,
        ImpTrib: 0,
        MonId: 'PES',
        MonCotiz: 1,
        FchServDesde: fechaHoy,
        FchServHasta: fechaHoy,
        FchVtoPago: fechaHoy,
        CbtesAsoc: [{
          Tipo: tipoComprobanteOriginal,
          PtoVta: puntoVenta,
          Nro: nroComprobanteOriginal,
          Cuit: parseInt(process.env.AFIP_CUIT)
        }]
      };

      const result = await afip.ElectronicBilling.createVoucher(ncData);

      const ncRef = db.collection('clientes').doc(uid).collection('notasCredito').doc();
      await ncRef.set({
        id: ncRef.id,
        uid,
        puntoVenta,
        tipoNotaCredito,
        nroComprobante,
        cae: result.CAE,
        caeFechaVto: result.CAEFchVto,
        importeTotal,
        caeOriginal,
        nroComprobanteOriginal,
        fechaEmision: admin.firestore.FieldValue.serverTimestamp(),
        ambiente: process.env.AFIP_PRODUCTION === 'true' ? 'produccion' : 'homologacion',
        estado: 'emitida',
        creadoEn: new Date().toISOString()
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, cae: result.CAE, caeFechaVto: result.CAEFchVto, nroComprobante, ncId: ncRef.id })
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
      const last = await afip.ElectronicBilling.getLastVoucher(puntoVenta, tipoComprobante);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, ultimo: last, siguiente: last + 1 }) };
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
