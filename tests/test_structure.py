import json
import unittest
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.request import urlopen

from backend import server as backend


class BackendServerTests(unittest.TestCase):
    def test_bind_address_and_port(self):
        self.assertEqual(8888, backend.PORT)
        self.assertEqual("127.0.0.1", backend.HOST)

    def test_api_health_route(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), backend.ViewerHandler)
        worker = Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            base = f"http://127.0.0.1:{httpd.server_port}"
            with urlopen(base + "/api/health", timeout=4) as response:
                self.assertEqual(200, response.status)
                self.assertEqual("ok", json.load(response)["status"])
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=4)


if __name__ == "__main__":
    unittest.main()
