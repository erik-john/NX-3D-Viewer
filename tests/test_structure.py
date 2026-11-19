import importlib.util
import json
from pathlib import Path
from threading import Thread
from urllib.request import urlopen
import unittest
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
SERVER_FILE = ROOT / "backend" / "server.py"

from backend import server as backend


class StructureTests(unittest.TestCase):
    def test_required_files_exist(self):
        expected = [
            "Run.bat", "backend/server.py", "frontend/index.html",
            "frontend/css/style.css", "frontend/js/app.js", "nx/export_stl.py",
            "README.md", "VERSION.txt",
        ]
        for name in expected:
            with self.subTest(name=name):
                self.assertTrue((ROOT / name).is_file())

    def test_fixed_port(self):
        self.assertEqual(8888, backend.PORT)
        self.assertEqual("127.0.0.1", backend.HOST)

    def test_http_routes(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), backend.ViewerHandler)
        worker = Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        base = f"http://127.0.0.1:{httpd.server_port}"
        try:
            with urlopen(base + "/api/health", timeout=4) as response:
                self.assertEqual(200, response.status)
                self.assertEqual("ok", json.load(response)["status"])
            for path, expected in [
                ("/", b"NX 3D Viewer"),
                ("/css/style.css", b".workspace"),
                ("/js/app.js", b"updateConnectionStatus"),
            ]:
                with self.subTest(path=path), urlopen(base + path, timeout=4) as response:
                    self.assertEqual(200, response.status)
                    self.assertIn(expected, response.read())
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=4)


if __name__ == "__main__":
    unittest.main()
