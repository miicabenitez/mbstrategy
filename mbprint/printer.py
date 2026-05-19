import usb.core
from escpos.printer import Usb, Network, File
from escpos.exceptions import Error as EscposError

KNOWN_VENDORS = [
    0x04b8,  # Epson
    0x0519,  # Star
    0x0416,  # Bixolon
    0x154f,  # SNBC
    0x0dd4,  # Custom
    0x1fc9,  # Sewoo
    0x20d1,  # Rongta
    0x0fe6,  # Goodson
]

def find_usb_printer():
    for vendor_id in KNOWN_VENDORS:
        devices = list(usb.core.find(idVendor=vendor_id, find_all=True))
        for dev in devices:
            return dev.idVendor, dev.idProduct
    # Fallback: any device with printer class (7)
    for dev in usb.core.find(find_all=True):
        try:
            if dev.bDeviceClass == 7:
                return dev.idVendor, dev.idProduct
            for cfg in dev:
                for intf in cfg:
                    if intf.bInterfaceClass == 7:
                        return dev.idVendor, dev.idProduct
        except Exception:
            continue
    return None, None


def get_printer():
    vendor, product = find_usb_printer()
    if vendor and product:
        try:
            return Usb(vendor, product, timeout=0, in_ep=0x82, out_ep=0x01)
        except Exception:
            pass
        try:
            return Usb(vendor, product)
        except Exception as e:
            raise RuntimeError(f"Impresora encontrada (0x{vendor:04x}:0x{product:04x}) pero no se pudo conectar: {e}")
    raise RuntimeError("No se encontró ninguna impresora ESC/POS USB")


def print_ticket(data: dict):
    """
    data keys (all optional except at least one line):
      negocio   str  — nombre del negocio (header)
      subtitulo str  — subtítulo debajo del nombre
      fecha     str  — fecha/hora
      cajero    str  — nombre del cajero
      turno     str  — número de turno
      items     list[{desc, qty, precio}]
      subtotal  str
      descuento str
      total     str
      medio     str  — medio de pago
      recibido  str
      vuelto    str
      footer    str  — mensaje de cierre
      corte     bool — true para cortar papel (default true)
    """
    p = get_printer()

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
    footer = data.get("footer", "¡Gracias por tu compra!")
    corte = data.get("corte", True)

    # Header
    p.set(align="center", bold=True, width=2, height=2)
    p.textln(negocio)
    p.set(align="center", bold=False, width=1, height=1)
    if subtitulo:
        p.textln(subtitulo)
    p.textln("-" * 32)

    # Meta
    if fecha:
        p.text(f"Fecha:  {fecha}\n")
    if cajero:
        p.text(f"Cajero: {cajero}\n")
    if turno:
        p.text(f"Turno:  {turno}\n")
    if fecha or cajero or turno:
        p.textln("-" * 32)

    # Items
    p.set(align="left")
    for it in items:
        desc = str(it.get("desc", ""))
        qty = str(it.get("qty", "1"))
        precio = str(it.get("precio", ""))
        line = f"{qty}x {desc}"
        price_str = precio.rjust(32 - len(line))
        if len(line) + len(precio) + 1 <= 32:
            p.text(f"{line}{price_str}\n")
        else:
            p.text(f"{line}\n")
            p.text(f"   {precio}\n")

    p.textln("-" * 32)

    # Totals
    def print_row(label, value):
        gap = 32 - len(label) - len(value)
        p.text(f"{label}{' ' * max(1, gap)}{value}\n")

    if subtotal:
        print_row("Subtotal:", subtotal)
    if descuento:
        print_row("Descuento:", descuento)
    p.set(bold=True)
    print_row("TOTAL:", total)
    p.set(bold=False)

    if medio:
        print_row("Medio de pago:", medio)
    if recibido:
        print_row("Recibido:", recibido)
    if vuelto:
        print_row("Vuelto:", vuelto)

    # Footer
    p.textln("-" * 32)
    p.set(align="center")
    p.textln(footer)
    p.text("\n\n\n")

    if corte:
        p.cut()

    p.close()
