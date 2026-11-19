"""Check the MS7 branding without requiring Siemens NX."""
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer
from urllib.request import urlopen
import unittest
import struct
from backend.server import ViewerHandler

ROOT = Path(__file__).resolve().parents[1]

class BrandingTests(unittest.TestCase):
    def test_brand_identity_and_toolbar_kept(self):
        html = (ROOT/'frontend'/'index.html').read_text(encoding='utf-8')
        css = (ROOT/'frontend'/'css'/'style.css').read_text(encoding='utf-8')
        self.assertIn('class="app-brand"', html)
        self.assertIn('NX 3D Viewer</span>', html)
        self.assertIn('3D Visualization Workspace</span>', html)
        self.assertIn('src="/assets/nx-cube-logo.png"', html)
        self.assertIn('class="toolbar-scroll"', html)
        for item in ['open-nx-button', 'fit-button', 'grid-button', 'axes-button', 'wire-button', 'tree-toggle']:
            self.assertIn('id="'+item+'"', html)
        self.assertIn('.toolbar-scroll', css)
        self.assertIn('overflow-x: auto', css)
        self.assertNotIn('LOCAL VIEWER', html)
        self.assertNotIn('NX available', html)
    def test_local_logo_asset_is_valid(self):
        image = ROOT/'frontend'/'assets'/'nx-cube-logo.png'
        self.assertTrue(image.is_file())
        raw = image.read_bytes()
        self.assertTrue(raw.startswith(b'\x89PNG\r\n\x1a\n'))
        width, height = struct.unpack('>II', raw[16:24])
        self.assertGreaterEqual(width, 256)
        self.assertGreaterEqual(height, 256)
    def test_logo_served_from_local_http(self):
        srv = ThreadingHTTPServer(('127.0.0.1', 0), ViewerHandler)
        thread = Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen('http://127.0.0.1:'+str(srv.server_port)+'/assets/nx-cube-logo.png',timeout=4) as response:
                self.assertEqual(200,response.status)
                self.assertTrue(response.read(8).startswith(b'\x89PNG'))
                self.assertEqual('no-store',response.headers.get('Cache-Control'))
        finally:
            srv.shutdown(); srv.server_close(); thread.join(timeout=3)
