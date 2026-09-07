#!/usr/bin/env python3
"""
Server locale per provare la pagina prima di pubblicarla.

Dichiara sempre la codifica UTF-8 nell'intestazione HTTP. Senza,
il browser deve indovinarla: alcuni ci riescono, altri leggono i
byte come Latin-1 e le lettere accentate diventano "Ã¨", "Â·".
"""
import http.server, os, socketserver

PORTA = int(os.environ.get("PORT", "8791"))
RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ogni formato testuale viaggia con la sua codifica scritta a chiare lettere.
TIPI = {
    ".html": "text/html; charset=utf-8",
    ".js":   "text/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg":  "image/svg+xml; charset=utf-8",
    ".md":   "text/markdown; charset=utf-8",
    ".txt":  "text/plain; charset=utf-8",
}


class Gestore(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        est = os.path.splitext(path)[1].lower()
        return TIPI.get(est) or super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, formato, *args):
        print("%s - %s" % (self.address_string(), formato % args), flush=True)


def main():
    os.chdir(RADICE)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORTA), Gestore) as s:
        print("Radar AI in ascolto su http://localhost:%d" % PORTA, flush=True)
        s.serve_forever()


if __name__ == "__main__":
    main()
