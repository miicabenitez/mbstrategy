const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}

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

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

exports.handler = async (event) => {
  const corsHeaders = getCorsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Método no permitido' }) };

  const authHeader = event.headers?.authorization || '';
  const idToken = authHeader.replace('Bearer ', '');
  if (!idToken) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'No autorizado' }) };

  try {
    await admin.auth().verifyIdToken(idToken);
  } catch {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Token inválido' }) };
  }

  try {
    const { emailDestino, pdfBase64, nombreArchivo, asunto, cuerpo } = JSON.parse(event.body || '{}');
    if (!emailDestino || !pdfBase64) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan datos requeridos' }) };

    await transporter.sendMail({
      from: `"MB Strategy" <${process.env.GMAIL_USER}>`,
      to: emailDestino,
      subject: asunto || 'Tu comprobante — MB Strategy',
      html: `<div style="font-family:Arial,sans-serif;color:#2C2C2C;padding:24px;">
        <div style="font-family:Georgia,serif;font-size:20px;color:#4a5e4d;margin-bottom:16px;">MB Strategy</div>
        <p style="font-size:14px;line-height:1.7;">${cuerpo || 'Adjunto encontrás tu comprobante.'}</p>
        <p style="font-size:12px;color:#888;margin-top:24px;">Este email fue generado automáticamente desde MB Strategy.</p>
      </div>`,
      attachments: [{
        filename: nombreArchivo || 'comprobante.pdf',
        content: Buffer.from(pdfBase64, 'base64'),
        contentType: 'application/pdf'
      }]
    });

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('send-factura-email:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error al enviar email' }) };
  }
};
