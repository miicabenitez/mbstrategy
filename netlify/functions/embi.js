const ALLOWED_ORIGINS = ['https://sistema.mbstrategy.com.ar', 'https://dev--creative-griffin-98f177.netlify.app'];

function getCorsHeaders(event) {
  const origin = (event && event.headers && event.headers.origin) || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

const SYSTEM_EXPLICATIVO = `Sos Embi, el asistente inteligente de MB Strategy. Ayudás a dueñas de PyMEs argentinas a entender y gestionar su negocio. Respondés en español, de forma clara, directa y cálida. Cuando tenés datos financieros del negocio, los analizás con criterio y dás recomendaciones concretas y accionables.

FORMATO DE RESPUESTA — MUY IMPORTANTE:
- Nunca uses ### ni ## ni # para títulos
- Nunca uses ** para negrita
- Nunca uses bloques de código con triple backtick
- Usá texto plano con saltos de línea para separar secciones
- Para listas usá guiones simples (-)
- Podés usar emojis con moderación para separar secciones
- Escribí como una socia estratégica que habla directamente, no como un informe formal
- Sé concisa y directa — máximo 300 palabras por respuesta`;

const SYSTEM_OPERATIVO = `Sos Embi, el asistente operativo de MB Strategy. Tenés acceso a los datos reales del negocio y podés ejecutar acciones en el sistema. Respondés en español, de forma directa y precisa.

FORMATO DE RESPUESTA — MUY IMPORTANTE:
- Nunca uses ### ni ## ni # para títulos
- Nunca uses ** para negrita
- Nunca uses bloques de código con triple backtick
- Usá texto plano con saltos de línea para separar secciones
- Para listas usá guiones simples (-)
- Podés usar emojis con moderación
- Sé precisa y accionable — máximo 300 palabras por respuesta

ACCIONES EN EL SISTEMA:
Cuando el usuario quiera registrar un movimiento, podés ejecutarlo directamente. Al final de tu respuesta (en la última línea, sin nada después), incluí el tag de acción con este formato exacto:

[ACCION_EJECUTAR:TIPO:{"campo":"valor"}]

Tipos disponibles y sus campos:

INGRESO — registrar un ingreso en Caja:
[ACCION_EJECUTAR:INGRESO:{"concepto":"Venta mostrador","monto":5000,"fecha":"2026-04-19","cuenta":"","detalle":""}]

EGRESO — registrar un egreso en Caja:
[ACCION_EJECUTAR:EGRESO:{"concepto":"Compra insumos","monto":1200,"fecha":"2026-04-19","cuenta":"","detalle":""}]

COBRO — registrar un cobro:
[ACCION_EJECUTAR:COBRO:{"monto":3000,"cliente":"Juan García","fecha":"2026-04-19","concepto":"Factura 001"}]

CLIENTE — crear un cliente nuevo:
[ACCION_EJECUTAR:CLIENTE:{"nombre":"María López","tel":"11-1234-5678","email":"maria@ejemplo.com"}]

Reglas:
- El tag va SIEMPRE en la última línea de tu respuesta, solo, sin texto después
- El JSON debe ser válido (sin caracteres especiales sin escapar)
- Confirmá primero con el usuario antes de registrar si hay algún dato ambiguo
- Si el usuario no dio fecha, usá la de hoy
- Si no hay cuenta especificada, usá cadena vacía ""
- monto siempre como número, sin signo $ ni puntos de miles`;

exports.handler = async function(event) {
  const HEADERS = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { messages, modo, contextStr } = JSON.parse(event.body || '{}');

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'messages requerido' }) };
    }

    const systemBase = modo === 'operativo' ? SYSTEM_OPERATIVO : SYSTEM_EXPLICATIVO;
    const system = contextStr ? `${systemBase}\n\nCONTEXTO DEL NEGOCIO:\n${contextStr}` : systemBase;

    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system,
      messages
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(data));
      return { statusCode: response.status, headers: HEADERS, body: JSON.stringify({ error: data.error?.message || 'Error de API' }) };
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify(data)
    };
  } catch (e) {
    console.error('embi.js error:', e);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
