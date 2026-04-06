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
- Sé precisa y accionable — máximo 300 palabras por respuesta`;

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
