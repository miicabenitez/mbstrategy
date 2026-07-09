// netlify/functions/send-pago-email.js
// Emails transaccionales del ciclo de pago: 'fallido' (pago rechazado, con gracia) y 'reactivado' (pago recuperado).
const nodemailer = require('nodemailer');
const HEADERS = { 'Content-Type': 'application/json' };
const APP_URL = 'https://sistema.mbstrategy.com.ar';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

function wrap(inner) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F5F4EF;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4EF;"><tr><td align="center" style="padding:24px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:#4a5e4d;border-radius:16px 16px 0 0;padding:32px 28px;text-align:center;">
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:normal;color:#ffffff;letter-spacing:2px;">MB STRATEGY</div>
</td></tr>
<tr><td style="background:#ffffff;padding:32px 28px;border-radius:0 0 16px 16px;">
${inner}
  <p style="font-size:13px;line-height:1.7;color:#4A5A4E;margin:28px 0 0;">Un abrazo,<br><strong>El equipo de MB Strategy</strong></p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

function ctaBtn(texto) {
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 4px;">
    <a href="${APP_URL}" style="display:inline-block;background:#1e2e22;color:#f4f0ea;text-decoration:none;padding:14px 40px;border-radius:10px;font-size:14px;font-weight:bold;">${texto}</a>
  </td></tr></table>`;
}

function buildFallido({ nombre, negocioNombre }) {
  return wrap(`
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#2C2C2C;margin-bottom:8px;">Hola, ${nombre || ''}</div>
  <p style="font-size:14px;line-height:1.7;color:#4A5A4E;margin:0 0 20px;">Intentamos procesar el pago de tu suscripción de <strong>${negocioNombre || 'tu negocio'}</strong> y la tarjeta lo rechazó. No pasa nada — es re común (vencimiento, límite, un banco con el día pesado).</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8ece9;border-radius:12px;border:1px solid #e3c4bd;margin-bottom:24px;"><tr><td style="padding:16px 20px;">
    <p style="font-size:13px;line-height:1.6;color:#7a4e46;margin:0;">Tenés unos días para actualizar tu tarjeta y seguir trabajando sin cortes. Tus datos están intactos — no se toca nada.</p>
  </td></tr></table>
  ${ctaBtn('Actualizar tarjeta')}
  <p style="font-size:12px;line-height:1.6;color:#888780;margin:14px 0 0;text-align:center;">Ingresás con tu usuario de siempre y el sistema te lleva al paso de actualizar el pago.</p>`);
}

function buildReactivado({ nombre }) {
  return wrap(`
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#2C2C2C;margin-bottom:8px;">¡Listo, ${nombre || ''}!</div>
  <p style="font-size:14px;line-height:1.7;color:#4A5A4E;margin:0 0 20px;">Tu pago se procesó correctamente y tu suscripción quedó al día. Podés seguir trabajando con normalidad — todo tal cual lo dejaste.</p>
  ${ctaBtn('Ir al sistema')}`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  if ((event.headers['x-internal-secret'] || '') !== (process.env.INTERNAL_SECRET || '')) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'No autorizado' }) };
  }
  try {
    const { tipo, email, nombre, negocioNombre } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'email requerido' }) };
    const asunto = tipo === 'reactivado' ? '¡Tu pago se procesó! — MB Strategy' : 'Tu pago no se pudo procesar — MB Strategy';
    const html = tipo === 'reactivado' ? buildReactivado({ nombre }) : buildFallido({ nombre, negocioNombre });
    await transporter.sendMail({ from: `"MB Strategy" <${process.env.GMAIL_USER}>`, to: email, subject: asunto, html });
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('send-pago-email error:', e);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
