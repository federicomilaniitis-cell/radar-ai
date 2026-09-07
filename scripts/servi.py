#!/usr/bin/env python3
"""Server locale per provare la pagina prima di pubblicarla."""
import http.server, os, socketserver
porta = int(os.environ.get("PORT", "8791"))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, f, *a): print("%s - %s" % (self.address_string(), f % a), flush=True)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", porta), H) as s:
    print("Radar AI in ascolto su http://localhost:%d" % porta, flush=True)
    s.serve_forever()
