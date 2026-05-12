const nodemailer = require('nodemailer');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

function fmt(n) {
  return '$ ' + parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatFecha(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: 'Method not allowed' };

  let data;
  try { data = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: 'Invalid JSON' };
  }

  console.log('enviando mail a:', data.emailDueno);

  const {
    negocio, emailDueno, cajera, apertura, cierre,
    saldoInicial, ingresos, egresos, saldoFinal,
    medios, productos, retiros, depositos
  } = data;

  if (!emailDueno) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Falta emailDueno' }) };

  try {
    const mediosRows = Object.entries(medios || {}).map(([k, v]) =>
      `<tr><td style="padding:8px 12px;color:#555;font-size:13px;">${k}</td><td style="padding:8px 12px;text-align:right;color:#2c2c2c;font-weight:600;font-size:13px;">${fmt(v)}</td></tr>`
    ).join('');

    const productosRows = (productos || []).map(p =>
      `<tr><td style="padding:8px 12px;color:#555;font-size:13px;">${p.nombre}</td><td style="padding:8px 12px;text-align:center;color:#555;font-size:13px;">${p.cantidad}</td><td style="padding:8px 12px;text-align:right;color:#2c2c2c;font-weight:600;font-size:13px;">${fmt(p.total)}</td></tr>`
    ).join('');

    const totalProductos = (productos || []).reduce((a, p) => a + (p.total || 0), 0);
    const cantItems = (productos || []).reduce((a, p) => a + (p.cantidad || 0), 0);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f0ea;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:32px auto;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
  <div style="background:#3a4e3d;padding:28px 32px;">
    <div style="display:flex;align-items:center;gap:16px;">
      <div style="width:48px;height:48px;border-radius:50%;background:#4a5e4d;border:2px solid rgba(176,144,136,0.4);display:inline-flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:18px;margin-right:14px;vertical-align:middle;flex-shrink:0;"><span style="color:#f4f0ea;">M</span><span style="color:#b09088;">B</span></div>
      <div>
        <div style="font-family:Georgia,serif;font-size:20px;color:#fff;font-weight:500;">Cierre de caja</div>
        <div style="font-size:12px;color:rgba(255,255,255,.65);margin-top:2px;">${negocio || 'MB Strategy'}</div>
      </div>
    </div>
  </div>
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #f0ebe6;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:#888;font-size:12px;width:40%;">Negocio</td><td style="padding:4px 0;color:#2c2c2c;font-size:13px;font-weight:600;">${negocio || '—'}</td></tr>
      <tr><td style="padding:4px 0;color:#888;font-size:12px;">Cajera</td><td style="padding:4px 0;color:#2c2c2c;font-size:13px;font-weight:600;">${cajera || '—'}</td></tr>
      <tr><td style="padding:4px 0;color:#888;font-size:12px;">Apertura</td><td style="padding:4px 0;color:#2c2c2c;font-size:13px;">${formatFecha(apertura)}</td></tr>
      <tr><td style="padding:4px 0;color:#888;font-size:12px;">Cierre</td><td style="padding:4px 0;color:#2c2c2c;font-size:13px;">${formatFecha(cierre)}</td></tr>
    </table>
  </div>
  <div style="background:#fff;padding:20px 32px;border-bottom:1px solid #f0ebe6;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#888;text-transform:uppercase;margin-bottom:12px;">Resumen del turno</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#555;font-size:13px;">Saldo inicial</td><td style="padding:6px 0;text-align:right;color:#2c2c2c;font-size:13px;">${fmt(saldoInicial)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;font-size:13px;">Ingresos</td><td style="padding:6px 0;text-align:right;color:#3a6e3d;font-size:13px;font-weight:600;">${fmt(ingresos)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;font-size:13px;">Egresos</td><td style="padding:6px 0;text-align:right;color:#b09088;font-size:13px;font-weight:600;">-${fmt(egresos)}</td></tr>
      <tr style="border-top:1.5px solid #f0ebe6;"><td style="padding:10px 0 6px;color:#2c2c2c;font-size:14px;font-weight:700;">Saldo final</td><td style="padding:10px 0 6px;text-align:right;color:#3a4e3d;font-size:16px;font-weight:700;">${fmt(saldoFinal)}</td></tr>
    </table>
  </div>
  ${mediosRows ? `<div style="background:#fff;padding:20px 32px;border-bottom:1px solid #f0ebe6;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#888;text-transform:uppercase;margin-bottom:12px;">Por medio de pago</div>
    <table style="width:100%;border-collapse:collapse;">${mediosRows}</table>
  </div>` : ''}
  ${productosRows ? `<div style="background:#fff;padding:20px 32px;border-bottom:1px solid #f0ebe6;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#888;text-transform:uppercase;margin-bottom:12px;">Detalle de ventas</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid #f0ebe6;">
        <th style="padding:6px 12px 8px;text-align:left;color:#aaa;font-size:11px;font-weight:600;">Producto</th>
        <th style="padding:6px 12px 8px;text-align:center;color:#aaa;font-size:11px;font-weight:600;">Cant.</th>
        <th style="padding:6px 12px 8px;text-align:right;color:#aaa;font-size:11px;font-weight:600;">Total</th>
      </tr></thead>
      <tbody>${productosRows}</tbody>
    </table>
    <div style="background:#3a4e3d;border-radius:8px;padding:10px 16px;margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:rgba(255,255,255,.75);font-size:12px;">${cantItems} item${cantItems !== 1 ? 's' : ''}</span>
      <span style="color:#fff;font-size:14px;font-weight:700;">${fmt(totalProductos)}</span>
    </div>
  </div>` : ''}
  ${(retiros || depositos) ? `<div style="background:#fff;padding:20px 32px;border-bottom:1px solid #f0ebe6;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#888;text-transform:uppercase;margin-bottom:12px;">Otros movimientos</div>
    <table style="width:100%;border-collapse:collapse;">
      ${retiros ? `<tr><td style="padding:6px 0;color:#555;font-size:13px;">Retiros</td><td style="padding:6px 0;text-align:right;color:#b09088;font-size:13px;font-weight:600;">-${fmt(retiros)}</td></tr>` : ''}
      ${depositos ? `<tr><td style="padding:6px 0;color:#555;font-size:13px;">Depósitos</td><td style="padding:6px 0;text-align:right;color:#3a6e3d;font-size:13px;font-weight:600;">${fmt(depositos)}</td></tr>` : ''}
    </table>
  </div>` : ''}
  <div style="background:#3a4e3d;padding:16px 32px;text-align:center;">
    <div style="color:rgba(255,255,255,.55);font-size:11px;">MB Strategy · sistema.mbstrategy.com.ar</div>
  </div>
</div>
</body></html>`;

    await transporter.sendMail({
      from: `"MB Strategy" <${process.env.GMAIL_USER}>`,
      to: emailDueno,
      subject: `Cierre de caja — ${cajera || 'Cajero'} — ${cierre || new Date().toLocaleDateString('es-AR')}`,
      html
    });

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('Error enviando mail de cierre:', e.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
