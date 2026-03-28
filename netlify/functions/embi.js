const SYSTEM_EXPLICATIVO = `Sos Embi, asistente virtual de MB Strategy. Tu rol es orientar y explicar cómo usar el sistema.
No tenés acceso a datos reales del negocio y no ejecutás acciones dentro del sistema.
Respondés en español rioplatense, tuteás siempre. Tono amigable y profesional. Respuestas cortas y concretas (máximo 4 párrafos).

MÓDULOS que podés explicar:
FINANZAS: KPIs automáticos (ingresos, egresos, resultado, cobros pendientes). Calculador de costos con margen.
COMERCIAL: Clientes, presupuestos (estados: Por enviar→Enviado→Consultado→Aprobado), PDF con datos de Mi cuenta.
COMPRAS: Productos→Proveedores→Necesidades→Cotización→OC→CC. Pago en CC genera egreso automático en Finanzas.
MEMBRESÍA: Plan activo y fechas.

Si piden algo que no existe en el sistema: [REPORT:sugerencia:MODULO:DESCRIPCION]
NUNCA inventes funcionalidades que no existen.`;

const SYSTEM_OPERATIVO_BASE = `Sos Embi, asistente operativo de MB Strategy. Tenés acceso a datos reales y podés ejecutar acciones con confirmación previa.
Respondés en español rioplatense, tuteás siempre. Sé breve y directo: máximo 3 líneas por respuesta, sin introducciones. Si necesitás datos, preguntá todo en una sola oración.

CAPACIDADES (con confirmación previa): INGRESO · EGRESO · CLIENTE · COBRO · OC_RECIBIDA

PROTOCOLO: detectás intención → pedís datos faltantes en una pregunta → mostrás resumen → esperás "sí"/"dale" → devolvés [ACCION_EJECUTAR:TIPO:JSON]. Nunca ejecutés sin confirmación.

MÓDULOS: Finanzas (KPIs, calculador) · Comercial (clientes, presupuestos, PDF) · Compras (productos→proveedores→necesidades→OC→CC) · Membresía

REPORTES: [REPORT:falla:MODULO:DESC] o [REPORT:sugerencia:MODULO:DESC]. Nunca inventés funcionalidades.`;

exports.handler = async function(event) {
  const ALLOWED_ORIGIN = 'https://sistema.mbstrategy.com.ar';
  const HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  }

  const origin = event.headers.origin || event.headers.referer || '';
  if (!origin.includes('mbstrategy.com.ar') && !origin.includes('netlify.app')) {
    return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const modo = body.modo || 'explicativo';
    const contextStr = body.contextStr || '';
    const messages = body.messages || [];

    const system = modo === 'operativo'
      ? SYSTEM_OPERATIVO_BASE + (contextStr ? '\n' + contextStr : '')
      : SYSTEM_EXPLICATIVO;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: Math.min(body.max_tokens || 700, 2048),
        system,
        messages
      })
    });

    const data = await response.json();
    return { statusCode: response.status, headers: HEADERS, body: JSON.stringify(data) };
  } catch (e) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Error interno del servidor' })
    };
  }
};
