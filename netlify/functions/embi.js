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

  // Validar origen
  const origin = event.headers.origin || event.headers.referer || '';
  if (!origin.includes('mbstrategy.com.ar') && !origin.includes('netlify.app')) {
    return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const body = JSON.parse(event.body);

    // Forzar modelo y limitar tokens
    body.model = 'claude-sonnet-4-20250514';
    body.max_tokens = Math.min(body.max_tokens || 1024, 2048);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: HEADERS,
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Error interno del servidor' })
    };
  }
};
