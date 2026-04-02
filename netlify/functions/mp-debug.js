// netlify/functions/mp-debug.js — TEMPORAL, remover después del diagnóstico
exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta parámetro id' }) };
  }
  const res = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
    headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  const responseHeaders = {};
  res.headers.forEach((v, k) => { responseHeaders[k] = v; });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch(e) { data = text; }
  const result = { mp_status: res.status, mp_headers: responseHeaders, mp_body: data };
  console.log('MP DEBUG:', JSON.stringify(result));
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result, null, 2)
  };
};
