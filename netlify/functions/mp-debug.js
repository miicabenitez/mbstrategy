// netlify/functions/mp-debug.js — TEMPORAL, remover después del diagnóstico
exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta parámetro id' }) };
  }
  const res = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
    headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
  });
  const data = await res.json();
  return {
    statusCode: res.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2)
  };
};
