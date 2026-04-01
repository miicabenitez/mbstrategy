// netlify/functions/send-welcome-email.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

function buildEmailHTML({ nombre, negocioNombre, email, password, plan, trialEnd }) {
  const planLabel = plan === 'pro' ? 'Pro' : 'Base · 7 días gratis';
  const isBase = plan !== 'pro';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F5F4EF;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4EF;"><tr><td align="center" style="padding:24px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<!-- HEADER -->
<tr><td style="background:#7A8E7D;border-radius:16px 16px 0 0;padding:32px 28px;text-align:center;">
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:normal;color:#ffffff;letter-spacing:2px;">MB STRATEGY</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:8px;">Bienvenido/a a tu sistema de gestión</div>
</td></tr>

<!-- BODY -->
<tr><td style="background:#ffffff;padding:32px 28px;">

  <!-- Saludo -->
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#2C2C2C;margin-bottom:8px;">Hola, ${nombre}</div>
  <p style="font-size:14px;line-height:1.7;color:#4A5A4E;margin:0 0 24px;">Tu cuenta en MB Strategy está lista. A partir de ahora tenés un sistema completo para gestionar <strong>${negocioNombre}</strong> con claridad y datos reales.</p>

  <!-- Credenciales -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4EF;border-radius:12px;margin-bottom:24px;"><tr><td style="padding:20px 24px;">
    <div style="font-size:10px;font-weight:bold;color:#7A8E7D;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">Tus credenciales</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="font-size:13px;color:#888780;padding:6px 0;border-bottom:1px solid #E7E5DF;">Usuario</td><td style="font-size:14px;font-weight:bold;color:#2C2C2C;padding:6px 0;border-bottom:1px solid #E7E5DF;text-align:right;">${email}</td></tr>
      <tr><td style="font-size:13px;color:#888780;padding:6px 0;border-bottom:1px solid #E7E5DF;">Contraseña temporal</td><td style="font-size:14px;font-weight:bold;color:#2C2C2C;padding:6px 0;border-bottom:1px solid #E7E5DF;text-align:right;font-family:monospace;">${password}</td></tr>
      <tr><td style="font-size:13px;color:#888780;padding:6px 0;">Plan</td><td style="font-size:14px;font-weight:bold;color:#7A8E7D;padding:6px 0;text-align:right;">${planLabel}</td></tr>
    </table>
  </td></tr></table>

  <!-- CTA -->
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
    <a href="https://sistema.mbstrategy.com.ar" style="display:inline-block;background:#7A8E7D;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:10px;font-size:14px;font-weight:bold;">Ingresar al sistema</a>
  </td></tr></table>

  ${isBase ? `<!-- Pro upsell -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;border-radius:12px;margin-bottom:24px;"><tr><td style="padding:20px 24px;">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#4A6A8A;margin-bottom:8px;">¿Querés que Embi trabaje por vos?</div>
    <p style="font-size:13px;line-height:1.6;color:#4A5A4E;margin:0;">Con el plan <strong>Pro</strong>, Embi no solo te explica: ejecuta acciones por vos. Registra ingresos, crea clientes, genera cobros. Vos le pedís, Embi lo hace.</p>
  </td></tr></table>` : ''}

  <!-- Academia -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#7A8E7D;border-radius:12px;margin-bottom:24px;"><tr><td style="padding:24px;">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#ffffff;margin-bottom:8px;">Oferta especial: Academia MB</div>
    <p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.85);margin:0 0 16px;">¿Sentís que tu negocio te maneja a vos en vez de vos a él? La Academia MB te da el método para salir del caos: dominás MB Gestión de punta a punta y te convertís en quien lidera, no en quien apaga incendios. Un equipo que te acompaña hasta que lo logres. Como clienta del sistema, tenés un precio preferencial exclusivo.</p>
    <a href="https://wa.me/5491176553318" style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.2);color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:bold;">Quiero saber más</a>
  </td></tr></table>

  <!-- Próximos pasos -->
  <div style="font-size:10px;font-weight:bold;color:#7A8E7D;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">Próximos pasos</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr><td style="width:28px;vertical-align:top;padding:6px 0;"><div style="width:24px;height:24px;background:#7A8E7D;border-radius:50%;color:#fff;font-size:12px;font-weight:bold;text-align:center;line-height:24px;">1</div></td><td style="padding:6px 0 6px 10px;font-size:13px;color:#4A5A4E;">Ingresá al sistema y cambiá tu contraseña</td></tr>
    <tr><td style="width:28px;vertical-align:top;padding:6px 0;"><div style="width:24px;height:24px;background:#7A8E7D;border-radius:50%;color:#fff;font-size:12px;font-weight:bold;text-align:center;line-height:24px;">2</div></td><td style="padding:6px 0 6px 10px;font-size:13px;color:#4A5A4E;">Completá el onboarding en 5 pasos</td></tr>
    <tr><td style="width:28px;vertical-align:top;padding:6px 0;"><div style="width:24px;height:24px;background:#7A8E7D;border-radius:50%;color:#fff;font-size:12px;font-weight:bold;text-align:center;line-height:24px;">3</div></td><td style="padding:6px 0 6px 10px;font-size:13px;color:#4A5A4E;">Conocé a Embi, tu asistente de gestión</td></tr>
  </table>

  ${isBase ? `<!-- Trial warning -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8ED;border-radius:10px;border:1px solid #F5E6C8;margin-bottom:24px;"><tr><td style="padding:14px 18px;">
    <p style="font-size:12px;line-height:1.6;color:#B08A42;margin:0;">Recordá: Tenés 7 días para explorar sin cargo. Si no cancelás, tu suscripción se activa automáticamente el <strong>${trialEnd || ''}</strong>.</p>
  </td></tr></table>` : ''}

  <!-- WhatsApp -->
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:8px;">
    <a href="https://wa.me/5491176553318?text=Hola!%20Vi%20la%20Academia%20MB%20Strategy%20en%20la%20p%C3%A1gina%20de%20planes%20y%20me%20interesa.%20%C2%BFMe%20cont%C3%A1s%20m%C3%A1s%3F" style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:10px;font-size:14px;font-weight:bold;">Escribinos por WhatsApp</a>
  </td></tr></table>

</td></tr>

<!-- FOOTER -->
<tr><td style="background:#F5F4EF;border-radius:0 0 16px 16px;padding:24px 28px;text-align:center;">
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#2C2C2C;font-weight:bold;">Micaela Benitez</div>
  <div style="font-size:11px;color:#888780;margin-top:2px;">Founder &amp; CEO</div>
  <div style="font-size:11px;color:#888780;margin-top:2px;">micaela@mbstrategy.com.ar</div>
  <div style="font-size:11px;color:#888780;margin-top:2px;">Buenos Aires, Argentina</div>
  <div style="margin-top:12px;">
    <a href="https://sistema.mbstrategy.com.ar/terminos.html" style="font-size:10px;color:#7A8E7D;text-decoration:none;margin:0 6px;">Términos y Condiciones</a>
    <a href="https://sistema.mbstrategy.com.ar/privacidad.html" style="font-size:10px;color:#7A8E7D;text-decoration:none;margin:0 6px;">Política de Privacidad</a>
  </div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }
  try {
    const data = JSON.parse(event.body || '{}');
    const { email, nombre, negocioNombre, password, plan, trialEnd } = data;
    if (!email || !nombre || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos requeridos' }) };
    }
    await transporter.sendMail({
      from: `"MB Strategy" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Bienvenido/a a MB Strategy, ${nombre} ✦`,
      html: buildEmailHTML({ nombre, negocioNombre: negocioNombre || 'tu negocio', email, password, plan: plan || 'base', trialEnd: trialEnd || '' })
    });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Error send-welcome-email:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error al enviar email' }) };
  }
};
