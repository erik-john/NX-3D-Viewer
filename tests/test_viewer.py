"""Validate the standalone viewer's local resources and interface contract."""
import importlib.util
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer
from urllib.request import urlopen
import unittest

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / 'frontend'

spec = importlib.util.spec_from_file_location('viewer_server_m2', ROOT / 'backend/server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ViewerTests(unittest.TestCase):
    def test_locally_bundled_source_files(self):
        for name in ['index.html', 'css/style.css', 'js/app.js', 'js/viewer.js', 'js/geometry.js']:
            with self.subTest(name=name):
                self.assertTrue((FRONT / name).is_file())

    def test_uses_local_esm_and_webgl(self):
        html = (FRONT / 'index.html').read_text(encoding='utf-8')
        renderer = (FRONT / 'js/viewer.js').read_text(encoding='utf-8')
        self.assertIn('type="module" src="/js/app.js"', html)
        self.assertIn("canvas.getContext('webgl2'", renderer)
        self.assertIn("canvas.getContext('webgl'", renderer)
        self.assertNotIn('cdn.jsdelivr', html + renderer)
        self.assertNotIn('http://', html + renderer)
        self.assertNotIn('https://', html + renderer)
        for element in ['viewer-canvas', 'sample-select', 'fit-button', 'grid-button',
                        'axes-button', 'wire-button', 'scene-title', 'viewer-error']:
            with self.subTest(element=element):
                self.assertIn(f'id="{element}"', html)

    def test_web_resources(self):
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ViewerHandler)
        t = Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            for url, excerpt in [
                ('/', b'Interactive 3D model viewer'),
                ('/css/style.css', b'.workspace'),
                ('/js/app.js', b'updateConnectionStatus'),
                ('/js/viewer.js', b'export class Viewer'),
                ('/js/geometry.js', b'export function createSample'),
            ]:
                with self.subTest(url=url), urlopen(f'http://127.0.0.1:{httpd.server_port}{url}', timeout=4) as response:
                    self.assertEqual(200, response.status)
                    self.assertIn(excerpt, response.read())
                    self.assertEqual('no-store', response.headers.get('Cache-Control'))
        finally:
            httpd.shutdown()
            httpd.server_close()
            t.join(timeout=4)

    def test_fixed_port_and_launcher(self):
        self.assertEqual(8888, server.PORT)
        self.assertEqual('127.0.0.1', server.HOST)
        self.assertIn('backend\\server.py', (ROOT / 'Run.bat').read_text())

    def test_release_documents_do_not_contain_dev_instructions(self):
        readme = (ROOT / 'README.md').read_text(encoding='utf-8').lower()
        self.assertNotIn('unit test', readme)
        self.assertNotIn('dev_server', readme)
        self.assertNotIn('development branch', readme)
        self.assertNotIn('v7.', (FRONT / 'index.html').read_text(encoding='utf-8').lower())
        self.assertNotIn('milestone 2', (FRONT / 'index.html').read_text(encoding='utf-8').lower())


if __name__ == '__main__':
    unittest.main()
