"""Dev server: like `python -m http.server`, but never cached, so an edited module is what the browser runs.

    python tools/serve.py [port]      # serves the repo root on http://127.0.0.1:8160
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8160), Handler).serve_forever()
