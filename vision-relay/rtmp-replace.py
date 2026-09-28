#!/usr/bin/env python3
"""Let a new VIGI publish replace the one already on the same stream key."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.parse
import urllib.request

CONTROL = "http://127.0.0.1:8088/control/drop/publisher"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        fields = urllib.parse.parse_qs(body)
        name = (fields.get("name") or [""])[0]
        app = (fields.get("app") or ["live"])[0]
        if name:
            url = f"{CONTROL}?app={urllib.parse.quote(app)}&name={urllib.parse.quote(name)}"
            try:
                urllib.request.urlopen(url, timeout=1).read()
            except Exception:
                pass
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8099), Handler).serve_forever()
