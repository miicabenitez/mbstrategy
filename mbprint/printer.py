import base64
import textwrap
from io import BytesIO

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
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode("SALDO FINAL\n")
    buf += _encode(_money(saldo_final) + "\n")
    buf += CMD_NORMAL + CMD_BOLD_OFF + CMD_LEFT

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
