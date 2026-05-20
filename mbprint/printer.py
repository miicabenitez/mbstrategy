import win32print


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


def print_ticket(data):
    """
    Accepts either:
      - a dict with a "lines" key (list of str) for raw text printing
      - a plain list of str (treated as lines)
      - a dict with structured ticket fields (negocio, items, total, etc.)
    """
    if isinstance(data, list):
        return _print_lines(data)
    if isinstance(data, dict) and "lines" in data:
        return _print_lines(data["lines"], cut=data.get("corte", True))
    if isinstance(data, dict):
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
    negocio = data.get("negocio", "MB Strategy")
    subtitulo = data.get("subtitulo", "")
    fecha = data.get("fecha", "")
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

    # Header
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode(negocio + "\n")
    buf += CMD_NORMAL + CMD_BOLD_OFF + CMD_CENTER
    if subtitulo:
        buf += _encode(subtitulo + "\n")
    buf += _encode("-" * LINE_WIDTH + "\n")

    # Meta
    buf += CMD_LEFT
    if fecha:
        buf += _encode(f"Fecha:  {fecha}\n")
    if cajero:
        buf += _encode(f"Cajero: {cajero}\n")
    if turno:
        buf += _encode(f"Turno:  {turno}\n")
    if fecha or cajero or turno:
        buf += _encode("-" * LINE_WIDTH + "\n")

    # Items
    for it in items:
        desc = str(it.get("desc", ""))
        qty = str(it.get("qty", "1"))
        precio = str(it.get("precio", ""))
        line = f"{qty}x {desc}"
        if len(line) + len(precio) + 1 <= LINE_WIDTH:
            price_str = precio.rjust(LINE_WIDTH - len(line))
            buf += _encode(f"{line}{price_str}\n")
        else:
            buf += _encode(f"{line}\n")
            buf += _encode(f"   {precio}\n")

    buf += _encode("-" * LINE_WIDTH + "\n")

    # Totals
    if subtotal:
        buf += _row("Subtotal:", subtotal)
    if descuento:
        buf += _row("Descuento:", descuento)
    buf += CMD_BOLD_ON
    buf += _row("TOTAL:", total)
    buf += CMD_BOLD_OFF

    if medio:
        buf += _row("Medio de pago:", medio)
    if recibido:
        buf += _row("Recibido:", recibido)
    if vuelto:
        buf += _row("Vuelto:", vuelto)

    # Footer
    buf += _encode("-" * LINE_WIDTH + "\n")
    buf += CMD_CENTER
    buf += _encode(footer + "\n")
    buf += b'\n\n\n'

    if corte:
        buf += CMD_CUT

    _send_raw(get_printer_name(), bytes(buf))
