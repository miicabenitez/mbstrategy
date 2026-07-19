// netlify/functions/mp-subscription.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();
const { PLAN_SERVER, TRIAL_DIAS, normalizarPlan } = require('./_planConfig');
const { verifyAuth } = require('./_auth');
const ALLOWED_ORIGINS = ['https://sistema.mbstrategy.com.ar', 'https://dev--creative-griffin-98f177.netlify.app'];

function getCorsHeaders(event) {
  const origin = (event && event.headers && event.headers.origin) || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
}

async function crearSuscripcionMP(plan, planData, email, externalRef, freeTrial) {
  const autoRecurring = {
    frequency: 1,
    frequency_type: 'months',
    transaction_amount: planData.precioPesos,
    currency_id: 'ARS'
  };
  if (freeTrial) {
    autoRecurring.free_trial = { frequency: TRIAL_DIAS, frequency_type: 'days' };
  }
  const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reason: `MB Strategy — Plan ${(PLAN_SERVER[normalizarPlan(plan)] || PLAN_SERVER.esencial).label}`,
      external_reference: externalRef,
      payer_email: email,
      auto_recurring: autoRecurring,
      notification_url: 'https://sistema.mbstrategy.com.ar/.netlify/functions/mp-webhook',
      back_url: 'https://sistema.mbstrategy.com.ar',
      status: 'pending'
    })
  });
  return mpRes;
}

async function cancelarPreapprovalMP(subscriptionId) {
  try {
    await fetch(`https://api.mercadopago.com/preapproval/${subscriptionId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
  } catch (e) { console.error('cancelarPreapprovalMP error:', e); }
}

exports.handler = async (event) => {
  const HEADERS = getCorsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  try {
    const body = JSON.parse(event.body || '{}');
    const { clienteId, email, nombre, negocioNombre, plan } = body;

    if (!PLAN_SERVER[normalizarPlan(plan)]) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Plan inválido' }) };
    }

    const configSnap = await db.collection('config').doc('planes').get();
    if (!configSnap.exists) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Configuración de planes no encontrada.' }) };
    }
    const planData = configSnap.data()[plan];
    if (!planData?.precioPesos) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: `Precio del plan "${plan}" no configurado` }) };
    }

    // ── FLUJO PÚBLICO (desde planes.html) ──
    if (email && !clienteId) {
      if (!nombre) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Nombre requerido' }) };
      }
      // Trial no reutilizable: flag trialUsado como fuente primaria, activoDesde como fallback retro-compat
      const clientesSnap = await db.collection('clientes').where('email', '==', email).get();
      const tuvoTrial = !clientesSnap.empty && clientesSnap.docs.some(d => { const m = d.data().membresia; return m && (m.trialUsado || m.activoDesde); });
      const freeTrial = (PLAN_SERVER[normalizarPlan(plan)]?.trial) && !tuvoTrial;
      // Guardar en pendientes (freeTrial se propaga al webhook para marcar trialUsado al crear la cuenta)
      const pendienteRef = await db.collection('pendientes_suscripcion').add({
        email, nombre, negocioNombre: negocioNombre || '',
        plan, estado: 'pendiente', freeTrial,
        creadoEn: FieldValue.serverTimestamp()
      });
      const mpRes = await crearSuscripcionMP(plan, planData, email, pendienteRef.id, freeTrial);
      const mpData = await mpRes.json();
      if (!mpRes.ok || !mpData.init_point) {
        console.error('MP API error (público):', JSON.stringify(mpData));
        return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Error al crear suscripción en Mercado Pago' }) };
      }
      await pendienteRef.update({ mpSubscriptionId: mpData.id });
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ init_point: mpData.init_point })
      };
    }

    // ── FLUJO INTERNO (desde Mi cuenta en el sistema) ── requiere token del dueño.
    if (!clienteId) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Datos inválidos' }) };
    }
    const _a = await verifyAuth(event);
    if (_a.error) return { statusCode: _a.statusCode, headers: HEADERS, body: JSON.stringify({ error: _a.error }) };
    if (clienteId !== _a.uid) return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'No autorizado' }) };
    const clienteSnap = await db.collection('clientes').doc(clienteId).get();
    if (!clienteSnap.exists) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Cliente no encontrado' }) };
    }
    const cliente = clienteSnap.data();
    if (cliente.membresia?.estado === 'activo') {
      return { statusCode: 409, headers: HEADERS, body: JSON.stringify({ error: 'El cliente ya tiene una suscripción activa' }) };
    }
    // Trial no reutilizable: flag trialUsado como fuente primaria, activoDesde como fallback retro-compat
    const yaTuvoTrial = !!(cliente.membresia?.trialUsado || cliente.membresia?.activoDesde);
    const freeTrial = (PLAN_SERVER[normalizarPlan(plan)]?.trial) && !yaTuvoTrial;
    // Actualizar tarjeta / re-suscribir: cancelar el preapproval viejo en MP antes de crear el nuevo (evita doble suscripción)
    const subVieja = cliente.membresia?.mpSubscriptionId;
    if (subVieja) await cancelarPreapprovalMP(subVieja);
    const mpRes = await crearSuscripcionMP(plan, planData, cliente.email, clienteId, freeTrial);
    const mpData = await mpRes.json();
    if (!mpRes.ok || !mpData.init_point) {
      console.error('MP API error:', JSON.stringify(mpData));
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Error al crear suscripción en Mercado Pago' }) };
    }
    // Crear la preapproval NO cambia el estado de ACCESO: ni lo otorga ni lo quita. Solo registra la
    // suscripción nueva (mpSubscriptionId + initPoint para "Continuar con el pago"). El acceso lo abre
    // SOLO el webhook cuando MP confirma el pago (mismo contrato que el alta pública). Por eso NO se
    // tocan estado / accesoBloqueado / pagoFalladoEn:
    //  - un cliente vencido/cancelado/bloqueado sigue bloqueado hasta el pago (no más acceso gratis);
    //  - un cliente en gracia legítima (pago falló, días vigentes) NO se castiga: conserva su acceso
    //    con su banner de gracia (precisión: pendiente-de-pago nunca otorga acceso nuevo ni quita el vigente).
    const updateInterno = {
      'membresia.plan': plan,
      'membresia.mpSubscriptionId': mpData.id,
      'membresia.precioPesos': planData.precioPesos,
      'membresia.precioUSD': planData.precioUSD,
      'membresia.initPoint': mpData.init_point,
      'membresia.creadoEn': FieldValue.serverTimestamp()
    };
    if (freeTrial) updateInterno['membresia.trialUsado'] = true;
    await db.collection('clientes').doc(clienteId).update(updateInterno);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ init_point: mpData.init_point })
    };
  } catch (err) {
    console.error('Error mp-subscription:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error interno del servidor' }) };
  }
};
