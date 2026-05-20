import base64
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


def _build_image_cmd(b64: str, max_width: int = 384) -> bytes:
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
            buf += CMD_CENTER + img_cmd + b"\n"

    # Header: negocio (double bold), ticket (bold), subtitulo (normal)
    buf += CMD_CENTER + CMD_BOLD_ON + CMD_DOUBLE
    buf += _encode(negocio + "\n")
    buf += CMD_NORMAL
    if ticket:
        buf += _encode(ticket + "\n")
    buf += CMD_BOLD_OFF
    if subtitulo:
        buf += _encode(subtitulo + "\n")
    buf += _encode("-" * LINE_WIDTH + "\n")

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
    buf += b'\n' * 6

    if corte:
        buf += CMD_CUT

    _send_raw(get_printer_name(), bytes(buf))
