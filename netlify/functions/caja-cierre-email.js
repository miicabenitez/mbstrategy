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

function generarPDF(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    const M = 40;
    const IW = W - M * 2; // inner width

    // ── Header ────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#3a4e3d').text('MB Strategy', M, M, { continued: false });
    doc.font('Helvetica').fontSize(10).fillColor('#555');
    const rightColW = IW;
    doc.text(d.negocio || '', M, M, { align: 'right', width: rightColW });
    doc.text('Cierre de Caja', M, M + 14, { align: 'right', width: rightColW });
    doc.text(formatFecha(d.cierre), M, M + 28, { align: 'right', width: rightColW });

    let y = M + 52;

    // Línea separadora terracota
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#b09088').lineWidth(1.5).stroke();
    y += 16;

    // ── Helpers ───────────────────────────────────────────────────
    function seccion(titulo) {
      y += 6;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#7a8e7d')
        .text(titulo.toUpperCase(), M, y);
      y += 14;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#d8d3ce').lineWidth(0.5).stroke();
      y += 8;
    }

    function fila(label, valor, color) {
      doc.font('Helvetica').fontSize(10).fillColor('#666').text(label, M, y);
      doc.font('Helvetica').fontSize(10).fillColor(color || '#2c2c2c')
        .text(valor, M, y, { align: 'right', width: IW });
      y += 18;
    }

    // ── 1. Datos del turno ─────────────────────────────────────────
    seccion('Datos del turno');
    fila('Cajera', d.cajera || '—');
    fila('Apertura', formatFecha(d.apertura));
    fila('Cierre', formatFecha(d.cierre));
    y += 6;

    // ── 2. Resumen ─────────────────────────────────────────────────
    seccion('Resumen');
    fila('Saldo inicial', fmt(d.saldoInicial));
    fila('Ingresos', fmt(d.ingresos), '#3a6e3d');
    fila('Egresos', '-' + fmt(d.egresos), '#b09088');
    y += 4;

    // Saldo final — separador fuerte + texto grande
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#3a4e3d').lineWidth(1).stroke();
    y += 4;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#3a4e3d').lineWidth(0.4).stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#3a4e3d').text('Saldo final', M, y);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#3a4e3d')
      .text(fmt(d.saldoFinal), M, y - 2, { align: 'right', width: IW });
    y += 28;

    // ── 3. Por medio de pago ───────────────────────────────────────
    const mediosEntries = Object.entries(d.medios || {});
    if (mediosEntries.length) {
      seccion('Por medio de pago');
      mediosEntries.forEach(([k, v]) => fila(nombreMedio(k), fmt(v)));
      y += 6;
    }

    // ── 4. Detalle de ventas ───────────────────────────────────────
    const prods = d.productos || [];
    if (prods.length) {
      seccion('Detalle de ventas');
      // Encabezado tabla
      const cCant = W - M - 80;
      const cTotal = W - M;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#aaa')
        .text('Producto', M, y)
        .text('Cant.', cCant - 20, y)
        .text('Total', M, y, { align: 'right', width: IW });
      y += 12;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#d8d3ce').lineWidth(0.5).stroke();
      y += 6;
      prods.forEach(p => {
        doc.font('Helvetica').fontSize(10).fillColor('#444').text(p.nombre || '—', M, y, { width: IW - 120 });
        doc.text(String(p.cantidad || 0), cCant - 20, y);
        doc.fillColor('#2c2c2c').text(fmt(p.total), M, y, { align: 'right', width: IW });
        y += 18;
      });
      // Total productos
      const totalProd = prods.reduce((a, p) => a + (p.total || 0), 0);
      const cantProd = prods.reduce((a, p) => a + (p.cantidad || 0), 0);
      y += 4;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#d8d3ce').lineWidth(0.5).stroke();
      y += 8;
      doc.font('Helvetica').fontSize(9).fillColor('#888').text(`${cantProd} item${cantProd !== 1 ? 's' : ''}`, M, y);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#3a4e3d')
        .text(fmt(totalProd), M, y, { align: 'right', width: IW });
      y += 22;
    }

    // ── 5. Retiros ────────────────────────────────────────────────
    if ((d.retirosDetalle && d.retirosDetalle.length) || d.depositos > 0) {
      seccion('Retiros');
      if (d.retirosDetalle && d.retirosDetalle.length) {
        d.retirosDetalle.forEach(function(r) {
          fila(r.concepto||'Retiro', '-' + fmt(r.monto), '#b09088');
        });
        if (d.retirosDetalle.length > 1 && d.retiros > 0) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#666').text('Total retiros', M, y);
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#b09088').text('-' + fmt(d.retiros), M, y, { align: 'right', width: IW });
          y += 18;
        }
      }
      if (d.depositos > 0) fila('Depósitos', fmt(d.depositos), '#3a6e3d');
      y += 6;
    }

    // ── 5b. Egresos del turno ─────────────────────────────────────
    if (d.egresosCaja && d.egresosCaja.length) {
      seccion('Egresos del turno');
      d.egresosCaja.forEach(function(e) {
        var label = (e.concepto||'Egreso') + (e.detalle ? ' · ' + e.detalle : '');
        fila(label, '-' + fmt(e.monto), '#b09088');
      });
      if (d.egresosCaja.length > 1 && d.egresosCajaTotal > 0) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#666').text('Total egresos', M, y);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#b09088').text('-' + fmt(d.egresosCajaTotal), M, y, { align: 'right', width: IW });
        y += 18;
      }
      y += 6;
    }

    // ── 6. Cuenta corriente ────────────────────────────────────────
    const cta = d.cuentaCorriente;
    if (cta && cta.total > 0) {
      seccion('Cuenta corriente · pendiente de cobro');
      (cta.detalle || []).forEach(p => {
        const label = p.cliente + (p.ticket ? '  #' + p.ticket : '');
        fila(label, fmt(p.monto), '#8a5f55');
      });
      y += 4;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#b09088').lineWidth(0.8).stroke();
      y += 8;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#8a5f55').text('Total pendiente', M, y);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#8a5f55').text(fmt(cta.total), M, y, { align: 'right', width: IW });
      y += 22;
    }

    // ── Footer ─────────────────────────────────────────────────────
    y += 16;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#d8d3ce').lineWidth(0.5).stroke();
    y += 10;
    doc.font('Helvetica').fontSize(8).fillColor('#aaa')
      .text('MB Strategy · sistema.mbstrategy.com.ar', M, y, { align: 'center', width: IW });

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
    medios, productos, retiros, depositos, retirosDetalle,
    egresosCaja, egresosCajaTotal, cuentaCorriente
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
  ${((retirosDetalle && retirosDetalle.length) || depositos) ? `<div style="background:#fff;padding:20px 32px;border-bottom:1px solid #f0ebe6;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#888;text-transform:uppercase;margin-bottom:12px;">Retiros</div>
    <table style="width:100%;border-collapse:collapse;">
      ${(retirosDetalle||[]).map(r => `<tr><td style="padding:5px 0;color:#555;font-size:13px;">${r.concepto||'Retiro'}</td><td style="padding:5px 0;text-align:right;color:#b09088;font-size:13px;font-weight:600;">-${fmt(r.monto)}</td></tr>`).join('')}
      ${(retirosDetalle && retirosDetalle.length > 1 && retiros) ? `<tr style="border-top:1px solid #f0ebe6;"><td style="padding:8px 0 4px;color:#555;font-size:13px;font-weight:700;">Total retiros</td><td style="padding:8px 0 4px;text-align:right;color:#b09088;font-size:13px;font-weight:700;">-${fmt(retiros)}</td></tr>` : ''}
      ${depositos ? `<tr><td style="padding:6px 0;color:#555;font-size:13px;">Depósitos</td><td style="padding:6px 0;text-align:right;color:#3a6e3d;font-size:13px;font-weight:600;">${fmt(depositos)}</td></tr>` : ''}
    </table>
  </div>` : ''}
  ${(egresosCaja && egresosCaja.length) ? `<div style="background:#fff;padding:20px 32px;border-bottom:1px solid #f0ebe6;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#888;text-transform:uppercase;margin-bottom:12px;">Egresos del turno</div>
    <table style="width:100%;border-collapse:collapse;">
      ${egresosCaja.map(e => `<tr><td style="padding:5px 0;color:#555;font-size:13px;">${e.concepto||'Egreso'}${e.detalle ? `<span style="color:#aaa;font-size:11px;margin-left:6px;">${e.detalle}</span>` : ''}</td><td style="padding:5px 0;text-align:right;color:#b09088;font-size:13px;font-weight:600;">-${fmt(e.monto)}</td></tr>`).join('')}
      ${(egresosCaja.length > 1 && egresosCajaTotal) ? `<tr style="border-top:1px solid #f0ebe6;"><td style="padding:8px 0 4px;color:#555;font-size:13px;font-weight:700;">Total egresos</td><td style="padding:8px 0 4px;text-align:right;color:#b09088;font-size:13px;font-weight:700;">-${fmt(egresosCajaTotal)}</td></tr>` : ''}
    </table>
  </div>` : ''}
  ${(cuentaCorriente && cuentaCorriente.total > 0) ? `<div style="background:#fdf5f2;padding:20px 32px;border-bottom:1px solid #f0ebe6;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><div style="width:3px;height:16px;background:#b09088;border-radius:2px;"></div><div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#8a5f55;text-transform:uppercase;">Cuenta corriente · pendiente de cobro</div></div>
    <table style="width:100%;border-collapse:collapse;">
      ${(cuentaCorriente.detalle || []).map(p => `<tr><td style="padding:5px 0;color:#555;font-size:13px;">${p.cliente || '—'}${p.ticket ? ' <span style="color:#aaa;font-size:11px;">#'+p.ticket+'</span>' : ''}</td><td style="padding:5px 0;text-align:right;color:#8a5f55;font-size:13px;font-weight:600;">${fmt(p.monto)}</td></tr>`).join('')}
    </table>
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #f0ebe6;display:flex;justify-content:space-between;">
      <span style="color:#888;font-size:12px;">Total pendiente</span>
      <span style="color:#8a5f55;font-size:14px;font-weight:700;">${fmt(cuentaCorriente.total)}</span>
    </div>
  </div>` : ''}
  <div style="background:#3a4e3d;padding:16px 32px;text-align:center;">
    <div style="color:rgba(255,255,255,.55);font-size:11px;">MB Strategy · sistema.mbstrategy.com.ar</div>
  </div>
</div>
</body></html>`;

    const pdfBuffer = await generarPDF({ negocio, cajera, apertura, cierre,
      saldoInicial, ingresos, egresos, saldoFinal, medios, productos, retiros, depositos, cuentaCorriente });

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
