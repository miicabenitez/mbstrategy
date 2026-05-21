import base64
import json
import textwrap
from io import BytesIO

import qrcode
import win32print
from PIL import Image


def get_printer_name():
    name = win32print.GetDefaultPrinter()
    if not name:
        raise RuntimeError("No se encontró ninguna impresora configurada")
    return name


def _send_raw(printer_name: str, data: bytes):
    hprinter = win32print.OpenPrinter(printer_name)
    try:
        hjob = win32print.StartDocPrinter(hprinter, 1, ("ticket", None, "RAW"))
        try:
            win32print.StartPagePrinter(hprinter)
            win32print.WritePrinter(hprinter, data)
            win32print.EndPagePrinter(hprinter)
        finally:
            win32print.EndDocPrinter(hprinter)
    finally:
        win32print.ClosePrinter(hprinter)


# --------------- ESC/POS command helpers ---------------

ESC = b'\x1b'
GS = b'\x1d'

CMD_INIT = ESC + b'@'
CMD_CENTER = ESC + b'a\x01'
CMD_LEFT = ESC + b'a\x00'
CMD_BOLD_ON = ESC + b'E\x01'
CMD_BOLD_OFF = ESC + b'E\x00'
CMD_DOUBLE = GS + b'!\x11'       # double width + double height
CMD_NORMAL = GS + b'!\x00'       # normal size
CMD_CUT = GS + b'V\x00'          # full cut
CMD_FEED = b'\n'

LINE_WIDTH = 32


def _encode(text: str) -> bytes:
    return text.encode("cp437", errors="replace")


def _row(label: str, value: str) -> bytes:
    gap = LINE_WIDTH - len(label) - len(value)
    return _encode(f"{label}{' ' * max(1, gap)}{value}\n")


def _separator() -> bytes:
    """Centered dotted separator (24 chars wide), restores LEFT alignment."""
    return CMD_CENTER + _encode("- " * 16 + "\n") + CMD_LEFT


def _money(n) -> str:
    """Format a number as ARS string like '$1.234'. Pass strings through unchanged."""
    if isinstance(n, str):
        return n
    try:
        return f"${int(round(float(n))):,}".replace(",", ".")
    except Exception:
        return "$0"


def _build_image_cmd(b64: str, max_width: int = 512) -> bytes:
    """Convert base64 image to ESC/POS raster command (GS v 0). Returns b'' on failure."""
    try:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
        img = Image.open(BytesIO(raw))
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        # Flatten transparency onto white (avoid black blob on transparent logos)
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg.convert("L")
        w, h = img.size
        if w > max_width:
            h = max(1, int(h * max_width / w))
            w = max_width
        w = (w // 8) * 8
        if w == 0:
            return b""
        img = img.resize((w, h)).convert("1")  # 1-bit with Floyd-Steinberg dithering
        bytes_per_row = w // 8
        raster = bytearray()
        px = img.load()
        for y in range(h):
            for xb in range(bytes_per_row):
                byte = 0
                for bit in range(8):
                    if px[xb * 8 + bit, y] == 0:  # black pixel
                        byte |= 1 << (7 - bit)
                raster.append(byte)
        xL, xH = bytes_per_row & 0xFF, (bytes_per_row >> 8) & 0xFF
        yL, yH = h & 0xFF, (h >> 8) & 0xFF
        return GS + b"v0" + bytes([0, xL, xH, yL, yH]) + bytes(raster)
    except Exception:
        return b""


def print_ticket(data):
    """
    Accepts either:
      - a dict with a "lines" key (list of str) for raw text printing
      - a plain list of str (treated as lines)
      - a dict with structured ticket fields (negocio, items, total, etc.)
      - a dict with tipo:"pedido" for production order layout
      - a dict with tipo:"cierre" for cash register closing layout
    """
    if isinstance(data, list):
        return _print_lines(data)
    if isinstance(data, dict) and "lines" in data:
        return _print_lines(data["lines"], cut=data.get("corte", True))
    if isinstance(data, dict):
        if data.get("tipo") == "pedido":
            return _print_pedido(data)
        if data.get("tipo") == "cierre":
            return _print_cierre(data)
        if data.get("tipo") == "factura":
            return _print_factura(data)
        return _print_structured(data)
    raise ValueError("data debe ser una lista de líneas o un dict")


def _print_lines(lines: list, cut: bool = True):
    buf = bytearray(CMD_INIT)
    for line in lines:
        buf += _encode(str(line) + "\n")
    buf += b'\n\n\n'
    if cut:
        buf += CMD_CUT
    _send_raw(get_printer_name(), bytes(buf))


def _print_structured(data: dict):
    logo_b64 = data.get("logo", "")
    negocio = data.get("negocio", "MB Strategy")
    subtitulo = data.get("subtitulo", "")
    ticket = data.get("ticket", "")
    fecha = data.get("fecha", "")
    hora = data.get("hora", "")
    cajero = data.get("cajero", "")
    turno = data.get("turno", "")
    items = data.get("items", [])
    subtotal = data.get("subtotal")
    descuento = data.get("descuento")
    total = data.get("total", "")
    medio = data.get("medio", "")
    recibido = data.get("recibido")
    vuelto = data.get("vuelto")
    footer = data.get("footer", "Gracias por tu compra!")
    corte = data.get("corte", True)

    buf = bytearray(CMD_INIT)

    # Logo (centered, silent if missing/invalid)
    if logo_b64:
        img_cmd = _build_image_cmd(logo_b64)
        if img_cmd:
            buf += CMD_CENTER
            buf += img_cmd

    # Header: negocio (double bold), ticket (double bold), subtitulo (normal)
    buf += b"\n"
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode(negocio + "\n")
    buf += CMD_NORMAL + b"\n"
    if ticket:
        buf += CMD_DOUBLE
        buf += _encode(ticket + "\n")
        buf += CMD_NORMAL
    buf += CMD_BOLD_OFF
    if subtitulo:
        buf += _encode(subtitulo + "\n")
    buf += _separator()

    # Meta
    buf += CMD_LEFT
    if fecha:
        buf += _encode(f"Fecha: {fecha}\n")
    if hora:
        buf += _encode(f"Hora:  {hora}\n")
    if cajero:
        buf += _encode(f"Cajero: {cajero}\n")
    if turno:
        buf += _encode(f"Turno:  {turno}\n")
    if fecha or hora or cajero or turno:
        buf += _separator()
        buf += b"\n"

    # Items
    for it in items:
        desc = str(it.get("desc", ""))
        qty = str(it.get("qty", "1"))
        precio = str(it.get("precio", ""))
        line = f"{qty}x {desc}"
        if len(line) + len(precio) + 1 <= LINE_WIDTH:
            price_str = precio.rjust(LINE_WIDTH - len(line))
            buf += _encode(f"{line}{price_str}\n\n")
        else:
            buf += _encode(f"{line}\n")
            buf += _encode(f"   {precio}\n\n")

    buf += b"\n"
    buf += _separator()

    # Totals
    if subtotal:
        buf += _row("Subtotal:", subtotal)
    if descuento:
        buf += _row("Descuento:", descuento)
    # TOTAL: centered, bold, double-size
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode(f"TOTAL  {total}\n")
    buf += CMD_NORMAL + CMD_BOLD_OFF + CMD_LEFT

    if medio:
        buf += b"\n"
        buf += _row("Medio de pago:", medio)
    if recibido:
        buf += _row("Recibido:", recibido)
    if vuelto:
        buf += _row("Vuelto:", vuelto)

    # Observaciones / detalle (optional, before the final separator)
    nota = data.get("observacion") or data.get("detalle") or data.get("observaciones")
    if nota:
        buf += b"\n"
        buf += _encode("Observaciones:\n")
        for line in textwrap.wrap(str(nota), LINE_WIDTH):
            buf += _encode(line + "\n")

    # Footer
    buf += _separator()
    buf += b"\n\n"
    buf += CMD_CENTER
    buf += _encode(footer + "\n")
    buf += b'\n' * 6

    if corte:
        buf += CMD_CUT

    _send_raw(get_printer_name(), bytes(buf))


def _print_pedido(data: dict):
    """Production order ticket (kitchen/workshop). Same header style as customer
    ticket but no totals/payment — just items with optional notes per item."""
    logo_b64 = data.get("logo", "")
    negocio = data.get("negocio", "MB Strategy")
    pedido = data.get("pedido", "")
    ticket = data.get("ticket", "")
    fecha = data.get("fecha", "")
    hora = data.get("hora", "")
    operador = data.get("operador", "")
    items = data.get("items", [])
    cliente = data.get("cliente", "")
    corte = data.get("corte", True)

    buf = bytearray(CMD_INIT)

    # Logo
    if logo_b64:
        img_cmd = _build_image_cmd(logo_b64)
        if img_cmd:
            buf += CMD_CENTER
            buf += img_cmd

    # Business name
    buf += b"\n"
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode(negocio + "\n")
    buf += CMD_NORMAL + CMD_BOLD_OFF
    buf += _separator()

    # Title block: "PEDIDO DE PRODUCCION" + P-XXXX + Ticket: V-XXXX
    buf += CMD_CENTER + CMD_BOLD_ON
    buf += _encode("PEDIDO DE PRODUCCION\n")
    buf += CMD_BOLD_OFF
    if pedido:
        buf += CMD_BOLD_ON + CMD_DOUBLE
        buf += _encode(pedido + "\n")
        buf += CMD_NORMAL + CMD_BOLD_OFF
    if ticket:
        buf += _encode(f"Ticket: {ticket}\n")
    buf += _separator()

    # Meta (left-aligned)
    buf += CMD_LEFT
    if fecha:
        buf += _encode(f"Fecha: {fecha}\n")
    if hora:
        buf += _encode(f"Hora:  {hora}\n")
    if operador:
        buf += _encode(f"Operador: {operador}\n")
    buf += _separator()

    # PRODUCTOS
    buf += CMD_LEFT + CMD_BOLD_ON
    buf += _encode("PRODUCTOS\n")
    buf += CMD_BOLD_OFF
    buf += b"\n"
    for it in items:
        desc = str(it.get("desc", ""))
        qty = str(it.get("qty", "1"))
        nota = it.get("detalle") or it.get("nota") or ""
        buf += CMD_BOLD_ON
        buf += _encode(f"{qty}x {desc}\n")
        buf += CMD_BOLD_OFF
        if nota:
            wrapped = textwrap.wrap(f"-> {nota}", LINE_WIDTH, subsequent_indent="   ")
            for line in wrapped:
                buf += _encode(line + "\n")
        buf += b"\n"
    buf += _separator()

    # Observaciones generales de la venta
    obs = data.get("observacion") or ""
    if obs:
        buf += CMD_LEFT + CMD_BOLD_ON
        buf += _encode("OBSERVACIONES\n")
        buf += CMD_BOLD_OFF
        for line in textwrap.wrap(str(obs), LINE_WIDTH):
            buf += _encode(line + "\n")
        buf += _separator()

    # Cliente (only if venta a cuenta)
    if cliente:
        buf += CMD_LEFT + _encode(f"Cliente: {cliente}\n")
        buf += _separator()

    # Footer
    buf += CMD_CENTER
    buf += _encode("- MB Strategy -\n")
    buf += b"\n" * 6

    if corte:
        buf += CMD_CUT

    _send_raw(get_printer_name(), bytes(buf))


def _print_cierre(data: dict):
    """Cash register closing ticket. Comprehensive shift-close summary printed
    on the thermal printer with the same look as customer/production tickets."""
    logo_b64 = data.get("logo", "")
    negocio = data.get("negocio", "MB Strategy")
    fecha_cierre = data.get("fecha_cierre", "")
    cajera = data.get("cajera", "")
    apertura = data.get("apertura", "")
    cierre = data.get("cierre", "")
    saldo_inicial = data.get("saldo_inicial", 0)
    ingresos = data.get("ingresos", 0)
    egresos = data.get("egresos", 0)
    saldo_final = data.get("saldo_final", 0)
    medios = data.get("medios", [])
    productos = data.get("productos", [])
    total_productos = data.get("total_productos", 0)
    cant_items = data.get("cant_items", 0)
    egresos_caja = data.get("egresos_caja", [])
    total_egresos_caja = data.get("total_egresos_caja", 0)
    retiros = data.get("retiros", [])
    total_retiros = data.get("total_retiros", 0)
    cuenta_corriente = data.get("cuenta_corriente", [])
    total_pendiente = data.get("total_pendiente", 0)
    modificaciones = data.get("modificaciones", [])
    corte = data.get("corte", True)

    def _line_with_price(label: str, price: str) -> bytes:
        """Print label + right-aligned price; wrap to next line if too long."""
        if len(label) + len(price) + 1 <= LINE_WIDTH:
            return _encode(label + price.rjust(LINE_WIDTH - len(label)) + "\n")
        return _encode(label + "\n" + " " * (LINE_WIDTH - len(price)) + price + "\n")

    buf = bytearray(CMD_INIT)

    # 1. Logo + negocio
    if logo_b64:
        img_cmd = _build_image_cmd(logo_b64)
        if img_cmd:
            buf += CMD_CENTER
            buf += img_cmd
    buf += b"\n"
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode(negocio + "\n")
    buf += CMD_NORMAL + CMD_BOLD_OFF

    # 2. Separator
    buf += _separator()

    # 3. CIERRE DE CAJA + fecha
    buf += CMD_CENTER + CMD_BOLD_ON
    buf += _encode("CIERRE DE CAJA\n")
    buf += CMD_BOLD_OFF
    if fecha_cierre:
        buf += _encode(str(fecha_cierre) + "\n")
    buf += CMD_LEFT

    # 4. Separator
    buf += _separator()

    # 5. DATOS DEL TURNO
    buf += CMD_BOLD_ON + _encode("DATOS DEL TURNO\n") + CMD_BOLD_OFF
    if cajera:
        buf += _row("Cajera:", str(cajera))
    if apertura:
        buf += _row("Apertura:", str(apertura))
    if cierre:
        buf += _row("Cierre:", str(cierre))

    # 6. Separator
    buf += _separator()

    # 7. RESUMEN
    buf += CMD_BOLD_ON + _encode("RESUMEN\n") + CMD_BOLD_OFF
    buf += _row("Saldo inicial:", _money(saldo_inicial))
    buf += _row("Ingresos:", _money(ingresos))
    buf += _row("Egresos:", "-" + _money(egresos))
    buf += _separator()
    buf += CMD_BOLD_ON
    buf += _row("SALDO FINAL:", _money(saldo_final))
    buf += CMD_BOLD_OFF

    # 8. Separator
    buf += _separator()

    # 9. POR MEDIO DE PAGO
    if medios:
        buf += CMD_BOLD_ON + _encode("POR MEDIO DE PAGO\n") + CMD_BOLD_OFF
        for m in medios:
            buf += _row(str(m.get("nombre", "")) + ":", _money(m.get("monto", 0)))
        buf += _separator()

    # 11. DETALLE DE VENTAS
    if productos:
        buf += CMD_BOLD_ON + _encode("DETALLE DE VENTAS\n") + CMD_BOLD_OFF
        for p in productos:
            nombre = str(p.get("nombre", ""))
            cantidad = str(p.get("cantidad", "1"))
            total = _money(p.get("total", 0))
            buf += _line_with_price(f"{nombre} x{cantidad}", total)
        buf += _separator()
        items_label = f"Total - {cant_items} item" + ("s" if cant_items != 1 else "")
        buf += _row(items_label, _money(total_productos))
        buf += _separator()

    # 13. EGRESOS DEL TURNO
    if egresos_caja:
        buf += CMD_BOLD_ON + _encode("EGRESOS DEL TURNO\n") + CMD_BOLD_OFF
        for e in egresos_caja:
            concepto = str(e.get("concepto", "Egreso"))
            detalle = str(e.get("detalle", ""))
            buf += _line_with_price(concepto, "-" + _money(e.get("monto", 0)))
            if detalle:
                for ln in textwrap.wrap("-> " + detalle, LINE_WIDTH, subsequent_indent="   "):
                    buf += _encode(ln + "\n")
        if len(egresos_caja) > 1:
            buf += _row("Total egresos:", "-" + _money(total_egresos_caja))
        buf += _separator()

    # 15. RETIROS
    if retiros:
        buf += CMD_BOLD_ON + _encode("RETIROS\n") + CMD_BOLD_OFF
        for r in retiros:
            concepto = str(r.get("concepto", "Retiro"))
            buf += _line_with_price(concepto, "-" + _money(r.get("monto", 0)))
        if len(retiros) > 1:
            buf += _row("Total retiros:", "-" + _money(total_retiros))
        buf += _separator()

    # 17. CUENTA CORRIENTE
    if cuenta_corriente:
        buf += CMD_BOLD_ON + _encode("CUENTA CORRIENTE\n") + CMD_BOLD_OFF
        for c in cuenta_corriente:
            cliente = str(c.get("cliente", ""))
            ticket = str(c.get("ticket", ""))
            label = cliente + (" - #" + ticket if ticket else "")
            buf += _line_with_price(label, _money(c.get("monto", 0)))
        buf += _row("Total pendiente:", _money(total_pendiente))
        buf += _separator()

    # 19. MODIFICACIONES
    if modificaciones:
        buf += CMD_BOLD_ON + _encode("MODIFICACIONES\n") + CMD_BOLD_OFF
        for mod in modificaciones:
            ticket = str(mod.get("ticket", ""))
            de = str(mod.get("de", ""))
            a = str(mod.get("a", ""))
            por = str(mod.get("por", ""))
            hora = str(mod.get("hora", ""))
            line1 = (("#" + ticket + " - ") if ticket else "") + de + " -> " + a
            line2 = por + (" - " + hora if hora else "")
            for ln in textwrap.wrap(line1, LINE_WIDTH):
                buf += _encode(ln + "\n")
            if line2.strip():
                buf += _encode("  " + line2 + "\n")
        buf += _separator()

    # 21. Footer
    buf += CMD_CENTER + _encode("- MB Strategy -\n")
    buf += b"\n" * 6

    # 22. Cut
    if corte:
        buf += CMD_CUT

    _send_raw(get_printer_name(), bytes(buf))


def _build_qr_afip_cmd(payload: dict) -> bytes:
    """Generate ESC/POS raster for AFIP QR from payload dict. Returns b'' on failure."""
    try:
        b64 = base64.b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode()
        url = "https://www.arca.gob.ar/fe/qr/?p=" + b64
        qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=4, border=1)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
        buf_io = BytesIO()
        img.save(buf_io, format="PNG")
        return _build_image_cmd(base64.b64encode(buf_io.getvalue()).decode())
    except Exception:
        return b""


def _print_factura(data: dict):
    """Fiscal ticket for AFIP electronic invoices (Factura A/B/C, NC, ND)."""
    logo_b64       = data.get("logo", "")
    negocio        = data.get("negocio", "MB Strategy")
    razon_social   = data.get("razonSocial", "")
    direccion      = data.get("direccion", "")
    cuit_emisor    = data.get("cuitEmisor", "")
    ing_brutos     = data.get("ingBrutos", "")
    tipo           = int(data.get("tipoComprobante", 11))
    pto_venta      = int(data.get("puntoVenta", 1))
    nro_comp       = int(data.get("nroComprobante", 0))
    fecha          = data.get("fecha", "")
    fecha_iso      = data.get("fechaISO", "")
    ticket_num     = data.get("ticketNum", "")
    cae            = str(data.get("cae", ""))
    cae_fecha_vto  = data.get("caeFechaVto", "")
    importe_total  = float(data.get("importeTotal", 0))
    descripcion    = data.get("descripcion", "")
    items          = data.get("items") or []
    razon_recep    = data.get("razonSocialReceptor", "")
    cuit_recep     = data.get("cuitReceptor", "")
    emisor_cond    = data.get("emisorCondicion", "")
    inicio_act     = data.get("inicioAct", "")
    condicion_iva_raw = data.get("condicionIVA", "")
    corte          = data.get("corte", True)

    TIPO_NOMBRE = {
        1: "FACTURA A", 6: "FACTURA B", 11: "FACTURA C",
        3: "NOTA DE CREDITO A", 8: "NOTA DE CREDITO B", 13: "NOTA DE CREDITO C",
        2: "NOTA DE DEBITO A",  7: "NOTA DE DEBITO B",  12: "NOTA DE DEBITO C",
    }
    CONDICION_IVA_LABEL = {
        "responsable_inscripto": "Responsable Inscripto",
        "exento": "Exento",
        "monotributista": "Monotributista",
    }
    condicion_iva_label = CONDICION_IVA_LABEL.get(condicion_iva_raw, "")

    pv_fmt    = str(pto_venta).zfill(4)
    nro_fmt   = str(nro_comp).zfill(8)
    nro_label = f"{pv_fmt}-{nro_fmt}"

    discrimina = tipo == 1
    emisor_ri  = emisor_cond == "responsable_inscripto"
    neto       = round(importe_total / 1.21, 2) if (discrimina or (tipo == 6 and emisor_ri)) else importe_total
    iva21      = round(importe_total - neto, 2)

    def _lwp(label: str, price: str) -> bytes:
        if len(label) + len(price) + 1 <= LINE_WIDTH:
            return _encode(label + price.rjust(LINE_WIDTH - len(label)) + "\n")
        return _encode(label + "\n" + " " * (LINE_WIDTH - len(price)) + price + "\n")

    buf = bytearray(CMD_INIT)

    # 1. Logo + cabecera negocio
    if logo_b64:
        img_cmd = _build_image_cmd(logo_b64)
        if img_cmd:
            buf += CMD_CENTER + img_cmd
    buf += b"\n"
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode(negocio + "\n")
    buf += CMD_NORMAL + CMD_BOLD_OFF
    if razon_social and razon_social != negocio:
        buf += CMD_CENTER + _encode(razon_social + "\n")
    if direccion:
        buf += CMD_CENTER + _encode(direccion + "\n")
    if cuit_emisor:
        buf += CMD_CENTER + _encode("CUIT: " + str(cuit_emisor) + "\n")
    if ing_brutos:
        buf += CMD_CENTER + _encode("Ing. Brutos: " + str(ing_brutos) + "\n")
    if inicio_act:
        buf += CMD_CENTER + _encode("Inicio Act.: " + str(inicio_act) + "\n")
    if condicion_iva_label:
        buf += CMD_CENTER + _encode(condicion_iva_label + "\n")

    buf += b"\n"
    buf += _separator()

    # 2. Tipo comprobante bold centrado
    buf += CMD_CENTER + CMD_BOLD_ON
    buf += _encode(TIPO_NOMBRE.get(tipo, "FACTURA C") + "\n")
    buf += CMD_BOLD_OFF + CMD_LEFT

    buf += b"\n"
    buf += _separator()

    # 3. Datos del comprobante
    buf += _row("P. Venta:", pv_fmt)
    buf += b"\n"
    buf += _row("Nro. Factura:", nro_fmt)
    if fecha:
        buf += b"\n"
        buf += _row("Fecha:", str(fecha))
    if ticket_num:
        buf += b"\n"
        buf += _row("Ticket:", str(ticket_num))

    # 4. Receptor (solo Factura A, tipo 1)
    if tipo == 1 and (razon_recep or cuit_recep):
        buf += _separator()
        buf += CMD_BOLD_ON + _encode("RECEPTOR\n") + CMD_BOLD_OFF
        if razon_recep:
            buf += _encode("Razon Social: " + razon_recep + "\n")
        if cuit_recep:
            buf += _encode("CUIT: " + str(cuit_recep) + "\n")
        buf += _encode("Cond. IVA: Resp. Inscripto\n")

    buf += _separator()

    buf += b"\n"
    # 5. Detalle de items
    buf += CMD_BOLD_ON + _encode("DETALLE\n") + CMD_BOLD_OFF + b"\n"
    if items:
        for it in items:
            desc     = str(it.get("desc", ""))
            qty      = float(it.get("cantidad", it.get("qty", 1)))
            precio   = float(it.get("precio", 0))
            subtotal = round(qty * precio, 2)
            qty_str  = str(int(qty)) if qty == int(qty) else f"{qty:.2f}"
            line     = f"{qty_str}x {desc}"
            buf += _lwp(line, _money(subtotal))
            if discrimina:
                neto_it = round(subtotal / 1.21, 2)
                buf += _encode(f"   Neto:{_money(neto_it)} IVA:{_money(subtotal-neto_it)}\n")
            buf += b"\n"
    else:
        for ln in textwrap.wrap(descripcion or "Servicios", LINE_WIDTH):
            buf += _encode(ln + "\n")
        buf += b"\n"

    buf += _separator()

    # 6. Totales
    if discrimina:
        buf += _lwp("Neto Gravado:", _money(neto))
        if iva21 > 0:
            buf += _lwp("IVA 21%:", _money(iva21))
    else:
        buf += _lwp("Subtotal:", _money(importe_total))
        buf += _lwp("Otros Tributos:", _money(0))

    buf += b"\n"
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode(f"TOTAL  {_money(importe_total)}\n")
    buf += CMD_NORMAL + CMD_BOLD_OFF + CMD_LEFT

    if tipo == 6 and emisor_ri and iva21 > 0:
        buf += _separator()
        buf += _encode(f"IVA Cont. Ley 27.743: {_money(iva21)}\n")

    buf += _separator()

    # 7. Datos facturación electrónica
    buf += CMD_BOLD_ON + _encode("FACTURACION ELECTRONICA\n") + CMD_BOLD_OFF
    if cae:
        buf += _encode("CAE: " + cae + "\n")
        buf += b"\n"
    if cae_fecha_vto:
        vto = str(cae_fecha_vto)
        if len(vto) == 8:
            vto = f"{vto[6:8]}/{vto[4:6]}/{vto[0:4]}"
        buf += _encode("Vto. CAE: " + vto + "\n")
        buf += b"\n"
    if fecha:
        buf += _encode("Emision: " + str(fecha) + "\n")

    # 8. QR AFIP
    if cae:
        try:
            cuit_num = int(str(cuit_emisor).replace("-", "").replace(" ", "")) if cuit_emisor else 0
            qr_payload = {
                "ver": 1, "fecha": str(fecha_iso),
                "cuit": cuit_num,
                "ptoVta": pto_venta, "tipoCmp": tipo, "nroCmp": nro_comp,
                "importe": importe_total, "moneda": "PES", "ctz": 1,
                "tipoDocRec": 80 if cuit_recep else 99,
                "nroDocRec": int(str(cuit_recep).replace("-", "").replace(" ", "")) if cuit_recep else 0,
                "tipoCodAut": "E", "codAut": int(cae),
            }
            qr_cmd = _build_qr_afip_cmd(qr_payload)
            if qr_cmd:
                buf += b"\n" + CMD_CENTER + qr_cmd + CMD_LEFT
        except Exception:
            pass

    buf += b"\n\n"
    buf += CMD_CENTER + _encode("- MB Strategy -\n")
    buf += b"\n" * 6

    if corte:
        buf += CMD_CUT

    _send_raw(get_printer_name(), bytes(buf))
