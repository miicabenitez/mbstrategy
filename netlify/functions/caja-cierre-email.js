const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

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
    const tz = 'America/Argentina/Buenos_Aires';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz })
      + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch (e) { return iso; }
}

function nombreMedio(nombre) {
  if (nombre === 'Caja mostrador') return 'Efectivo';
  return nombre;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function generarPDF(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    const M = 40;
    const green = hexToRgb('#3a4e3d');
    const greenLight = hexToRgb('#4a5e4d');
    const terra = hexToRgb('#b09088');
    const cream = hexToRgb('#f4f0ea');

    // ── Header verde ──────────────────────────────────────────────
    doc.rect(0, 0, W, 90).fill(`rgb(${green.join(',')})`);

    // Círculo MB logo
    doc.circle(M + 20, 45, 20).fill(`rgb(${greenLight.join(',')})`);
    doc.fontSize(13).fillColor(`rgb(${cream.join(',')})`).text('M', M + 8, 38, { continued: true });
    doc.fillColor(`rgb(${terra.join(',')})`).text('B');

    // Strategy + título
    doc.fontSize(9).fillColor(`rgba(244,240,234,0.6)`).text('MB Strategy', M + 50, 28);
    doc.fontSize(18).fillColor(`rgb(${cream.join(',')})`).text('Cierre de Caja', M + 50, 40);

    // Negocio + fecha/cajera a la derecha
    const rightX = W - M;
    doc.fontSize(9).fillColor(`rgba(244,240,234,0.65)`)
      .text(d.negocio || '', 0, 28, { align: 'right', width: rightX })
      .text(formatFecha(d.cierre), 0, 42, { align: 'right', width: rightX })
      .text(d.cajera || '', 0, 56, { align: 'right', width: rightX });

    let y = 110;

    // ── Sección helper ─────────────────────────────────────────────
    function seccion(titulo) {
      doc.fontSize(8).fillColor(`rgb(${greenLight.join(',')})`)
        .text(titulo.toUpperCase(), M, y, { letterSpacing: 1 });
      y += 16;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#e8e3de').lineWidth(0.5).stroke();
      y += 8;
    }

    function fila(label, valor, color) {
      doc.fontSize(10).fillColor('#555').text(label, M, y);
      doc.fontSize(10).fillColor(color || '#2c2c2c').text(valor, 0, y, { align: 'right', width: W - M });
      y += 18;
    }

    // ── 1. Datos del turno ─────────────────────────────────────────
    seccion('Datos del turno');
    fila('Cajera', d.cajera || '—');
    fila('Apertura', formatFecha(d.apertura));
    fila('Cierre', formatFecha(d.cierre));
    y += 10;

    // ── 2. Resumen ─────────────────────────────────────────────────
    seccion('Resumen');
    fila('Saldo inicial', fmt(d.saldoInicial));
    fila('Ingresos', fmt(d.ingresos), `rgb(${hexToRgb('#3a6e3d').join(',')})`);
    fila('Egresos', '-' + fmt(d.egresos), `rgb(${terra.join(',')})`);
    y += 4;

    // Bloque saldo final
    doc.rect(M, y, W - M * 2, 32).fill(`rgb(${green.join(',')})`);
    doc.fontSize(11).fillColor(`rgb(${cream.join(',')})`).text('Saldo final', M + 12, y + 10);
    doc.fontSize(13).fillColor(`rgb(${cream.join(',')})`).text(fmt(d.saldoFinal), 0, y + 9, { align: 'right', width: W - M - 12 });
    y += 44;

    // ── 3. Por medio de pago ───────────────────────────────────────
    const mediosEntries = Object.entries(d.medios || {});
    if (mediosEntries.length) {
      y += 6;
      seccion('Por medio de pago');
      mediosEntries.forEach(([k, v]) => fila(nombreMedio(k), fmt(v)));
      y += 6;
    }

    // ── 4. Detalle de ventas ───────────────────────────────────────
    const prods = d.productos || [];
    if (prods.length) {
      y += 6;
      seccion('Detalle de ventas');
      // Header tabla
      doc.fontSize(8).fillColor('#aaa')
        .text('Producto', M, y)
        .text('Cant.', M + 260, y)
        .text('Total', 0, y, { align: 'right', width: W - M });
      y += 14;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#e8e3de').lineWidth(0.5).stroke();
      y += 6;
      prods.forEach(p => {
        doc.fontSize(10).fillColor('#444').text(p.nombre || '—', M, y, { width: 240 });
        doc.text(String(p.cantidad || 0), M + 260, y);
        doc.fillColor('#2c2c2c').text(fmt(p.total), 0, y, { align: 'right', width: W - M });
        y += 18;
      });
      // Footer totales
      const totalProd = prods.reduce((a, p) => a + (p.total || 0), 0);
      const cantProd = prods.reduce((a, p) => a + (p.cantidad || 0), 0);
      doc.rect(M, y, W - M * 2, 26).fill(`rgb(${green.join(',')})`);
      doc.fontSize(9).fillColor('rgba(255,255,255,0.7)').text(`${cantProd} items`, M + 12, y + 8);
      doc.fontSize(11).fillColor(`rgb(${cream.join(',')})`).text(fmt(totalProd), 0, y + 7, { align: 'right', width: W - M - 12 });
      y += 38;
    }

    // ── 5. Otros movimientos ───────────────────────────────────────
    if (d.retiros > 0 || d.depositos > 0) {
      y += 6;
      seccion('Otros movimientos');
      if (d.retiros > 0) fila('Retiros', '-' + fmt(d.retiros), `rgb(${terra.join(',')})`);
      if (d.depositos > 0) fila('Depósitos', fmt(d.depositos), `rgb(${hexToRgb('#3a6e3d').join(',')})`);
      y += 6;
    }

    // ── Footer ─────────────────────────────────────────────────────
    const pageH = 841.89;
    doc.rect(0, pageH - 36, W, 36).fill(`rgb(${green.join(',')})`);
    doc.fontSize(8).fillColor('rgba(244,240,234,0.5)')
      .text('MB Strategy · sistema.mbstrategy.com.ar', 0, pageH - 22, { align: 'center', width: W });

    doc.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: 'Method not allowed' };

  let data;
  try { data = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: 'Invalid JSON' };
  }

  console.log('enviando mail a:', data.emailDueno);
  console.log('datos recibidos:', JSON.stringify({ productos: data.productos, retiros: data.retiros, depositos: data.depositos }));

  const {
    negocio, emailDueno, cajera, apertura, cierre,
    saldoInicial, ingresos, egresos, saldoFinal,
    medios, productos, retiros, depositos
  } = data;

  if (!emailDueno) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Falta emailDueno' }) };

  try {
    const mediosRows = Object.entries(medios || {}).map(([k, v]) =>
      `<tr><td style="padding:8px 12px;color:#555;font-size:13px;">${nombreMedio(k)}</td><td style="padding:8px 12px;text-align:right;color:#2c2c2c;font-weight:600;font-size:13px;">${fmt(v)}</td></tr>`
    ).join('');

    const productosRows = (productos || []).map(p =>
      `<tr><td style="padding:8px 12px;color:#555;font-size:13px;">${p.nombre}</td><td style="padding:8px 12px;text-align:center;color:#555;font-size:13px;">${p.cantidad}</td><td style="padding:8px 12px;text-align:right;color:#2c2c2c;font-weight:600;font-size:13px;">${fmt(p.total)}</td></tr>`
    ).join('');

    const totalProductos = (productos || []).reduce((a, p) => a + (p.total || 0), 0);
    const cantItems = (productos || []).reduce((a, p) => a + (p.cantidad || 0), 0);

    const _fechaCierreShort = formatFecha(cierre).split(' ')[0];
    const _efectivo = (medios || {})['Caja mostrador'] || (medios || {})['Efectivo'] || 0;
    const _cantProductos = (productos || []).reduce((a, p) => a + (p.cantidad || 0), 0);
    const _preheader = `Turno cerrado; saldo final ${fmt(saldoFinal)}; efectivo ${fmt(_efectivo)}${_cantProductos > 0 ? '; ' + _cantProductos + ' productos vendidos' : ''}`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f0ea;font-family:Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#ffffff;">${_preheader}</div>
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

    const pdfBuffer = await generarPDF({ negocio, cajera, apertura, cierre,
      saldoInicial, ingresos, egresos, saldoFinal, medios, productos, retiros, depositos });

    await transporter.sendMail({
      from: `"MB Strategy" <${process.env.GMAIL_USER}>`,
      to: emailDueno,
      subject: `Cierre de caja — ${cajera || 'Cajero'} — ${_fechaCierreShort}`,
      html,
      attachments: [{
        filename: `cierre-caja-${(cajera || 'cajero').replace(/\s+/g, '-')}-${_fechaCierreShort}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    });

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('Error enviando mail de cierre:', e.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
