"""Serve the NX 3D Viewer interface on the fixed local port."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
from urllib.parse import urlsplit

PORT = 8888
HOST = "127.0.0.1"
FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"


class ViewerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path == "/api/health":
            payload = json.dumps({"status": "ok"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None


def main():
    with ThreadingHTTPServer((HOST, PORT), ViewerHandler) as server:
        print(f"NX 3D Viewer: http://{HOST}:{PORT}/")
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            print("\nStopping NX 3D Viewer")


if __name__ == "__main__":
    main()
