import sys
import os
import threading
import logging

from flask import Flask, request, jsonify
from flask_cors import CORS
import pystray
from PIL import Image

from printer import print_ticket, get_printer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PORT = 8765
ALLOWED_ORIGIN = "https://sistema.mbstrategy.com.ar"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("mbprint")

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)
CORS(app, origins=[
    ALLOWED_ORIGIN,
    "http://localhost",
    "http://127.0.0.1",
    "https://dev--creative-griffin-98f177.netlify.app",
])


@app.route("/status", methods=["GET"])
def status():
    return jsonify({"status": "ok", "version": "1.0.0"})


@app.route("/print", methods=["POST"])
def print_endpoint():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"ok": False, "error": "JSON inválido"}), 400
    try:
        print_ticket(data)
        log.info("Ticket impreso OK")
        return jsonify({"ok": True})
    except Exception as e:
        log.error(f"Error al imprimir: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


def run_flask():
    log.info(f"MB Print escuchando en http://localhost:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False, use_reloader=False)


# ---------------------------------------------------------------------------
# System tray
# ---------------------------------------------------------------------------
def load_icon() -> Image.Image:
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    icon_path = os.path.join(base, "apple-touch-icon.png")
    try:
        img = Image.open(icon_path).convert("RGBA").resize((64, 64))
        return img
    except Exception:
        # Fallback: simple green square
        img = Image.new("RGBA", (64, 64), (26, 53, 40, 255))
        return img


def check_printer_status(icon, item):
    try:
        get_printer().close()
        icon.notify("Impresora detectada y lista.", "MB Print")
    except Exception as e:
        icon.notify(f"Sin impresora: {e}", "MB Print")


def on_quit(icon, item):
    icon.stop()
    os._exit(0)


def build_menu():
    return pystray.Menu(
        pystray.MenuItem("MB Print v1.0 — activo", None, enabled=False),
        pystray.MenuItem(f"Puerto: localhost:{PORT}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Verificar impresora", check_printer_status),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Salir", on_quit),
    )


def main():
    # Start Flask in background thread (daemon so it dies with tray)
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    icon = pystray.Icon(
        name="MB Print",
        icon=load_icon(),
        title="MB Print — activo",
        menu=build_menu(),
    )
    icon.run()


if __name__ == "__main__":
    main()
