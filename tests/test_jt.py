"""MS40: JT file routing and conversion checks without a licensed NX runtime."""

import io
import json
import importlib.util
import sys
import types
import struct
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen

from backend import nx_service, server, workspace

JT_HEADER = b'Version 10.3 JT  DM 9.2.2.0'.ljust(80, b' ') + b'\n\r\n' + b'\x00' * 100


def stl_triangle():
    return b'JT test'.ljust(80, b'\0') + struct.pack('<I', 1) + struct.pack(
        '<12fH', 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)


class BasicJtTests(unittest.TestCase):
    def test_jt_header_and_journal_are_passed_without_mutating_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'Bolt_M12x55_303.jt'
            source.write_bytes(JT_HEADER)
            journal = root / 'run_journal.exe'
            journal.write_bytes(b'fake')
            calls = []

            def simulate_nx(command, **kwargs):
                calls.append(command)
                Path(command[4]).write_bytes(stl_triangle())
                return type('Result', (), {'returncode': 0, 'stdout': '', 'stderr': ''})()

            with patch.object(nx_service.subprocess, 'run', side_effect=simulate_nx):
                output = nx_service.convert_jt(source, root, journal)
            self.assertTrue(output.is_file())
            self.assertEqual(source.read_bytes(), JT_HEADER)
            self.assertEqual(calls[0][3], str(source))
            self.assertEqual(calls[0][1], str(nx_service.JOURNAL))
            self.assertTrue(nx_service._inspect_stl(output)['valid'])

    def test_nx_open_journal_opens_jt_as_geometry_without_saveas(self):
        journal_path = Path(__file__).resolve().parents[1] / 'nx' / 'export_stl.py'
        spec = importlib.util.spec_from_file_location('jt_journal_test', journal_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        part = types.SimpleNamespace(Bodies=[types.SimpleNamespace(Tag=11, Name='Bolt body')],
                                     ComponentAssembly=None, Name='Bolt M12')
        opened = []
        session = types.SimpleNamespace(Parts=types.SimpleNamespace(
            OpenBaseDisplay=lambda source: opened.append(source) or part))
        fake_nx = types.SimpleNamespace(Session=types.SimpleNamespace(GetSession=lambda: session))

        def export_stl(fake_session, bodies, filename):
            self.assertIs(fake_session, session)
            self.assertEqual(bodies[0].Tag, 11)
            Path(filename).write_bytes(stl_triangle())

        with tempfile.TemporaryDirectory() as folder, \
             patch.dict(sys.modules, {'NXOpen': fake_nx}), \
             patch.object(module, 'export_bodies', side_effect=export_stl):
            output = Path(folder) / 'abc.stl'
            manifest = Path(folder) / 'abc.json'
            source = str(Path(folder) / 'Bolt_M12x55_303.jt')
            module.export(source, str(output), str(manifest))
            self.assertEqual(opened, [source])
            self.assertEqual(json.loads(manifest.read_text())['root']['name'], 'Bolt M12')
            self.assertTrue(output.is_file())

    def test_incorrect_jt_header_rejected_before_launch(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'fake.jt'
            source.write_bytes(b'not a JT file')
            with patch.object(nx_service.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'JT file header'):
                    nx_service.convert_jt(source, folder, 'run_journal.exe')
                run.assert_not_called()

    def test_workspaces_accept_prt_and_jt_only(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'uploads'
            with patch.object(workspace, 'ROOT', root):
                root.mkdir()
                (root / 'Bolt_M12x55.jt').write_bytes(JT_HEADER)
                (root / 'Bolt_M12x55_303.jt').write_bytes(JT_HEADER)
                (root / 'part.prt').write_bytes(b'NX')
                (root / 'notes.txt').write_text('test')
                files = {item['name']: item for item in workspace.listing()['files']}
                self.assertTrue(files['Bolt_M12x55.jt']['canOpen'])
                self.assertTrue(files['Bolt_M12x55_303.jt']['canOpen'])
                self.assertTrue(files['part.prt']['canOpen'])
                self.assertFalse(files['notes.txt']['canOpen'])
                self.assertEqual(workspace.file_for_open('Bolt_M12x55_303.jt'),
                                 root / 'Bolt_M12x55_303.jt')
                with self.assertRaises(workspace.WorkspaceError):
                    workspace.file_for_open('notes.txt')

    def test_workspace_open_jt_routes_to_jt_conversion_and_produces_viewer_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            storage = root / 'uploads'
            storage.mkdir()
            jt = storage / 'Bolt_M12x55_303.jt'
            jt.write_bytes(JT_HEADER)
            exports = root / 'exports'
            exports.mkdir()
            called = []

            def mock_convert(path, output_dir, journal):
                called.append(str(path))
                out = exports / '0123456789abcdef0123456789abcdef.stl'
                out.write_bytes(stl_triangle())
                return out

            with patch.object(workspace, 'ROOT', storage), \
                 patch.object(server, 'find_nx_journal', return_value='run_journal.exe'), \
                 patch.object(server, 'convert_jt', side_effect=mock_convert), \
                 patch.object(server, 'convert_prt') as prt_converter:
                server.ViewerHandler.export_directory = exports
                server.ViewerHandler.assets = {}
                httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ViewerHandler)
                thread = threading.Thread(target=httpd.serve_forever, daemon=True)
                thread.start()
                try:
                    url = f'http://127.0.0.1:{httpd.server_port}'
                    request = Request(url + '/api/workspace/open',
                                      data=json.dumps({'path': jt.name}).encode('utf-8'),
                                      headers={'Content-Type': 'application/json',
                                               'Origin': url}, method='POST')
                    with urlopen(request, timeout=6) as response:
                        payload = json.load(response)
                    self.assertTrue(payload['ok'])
                    self.assertEqual(payload['name'], jt.name)
                    self.assertEqual(payload['geometryMode'], 'combined')
                    self.assertIn('.stl', payload['modelUrl'])
                    self.assertEqual(called, [str(jt)])
                    prt_converter.assert_not_called()
                    with urlopen(url + payload['modelUrl'], timeout=6) as response:
                        self.assertEqual(response.read(), stl_triangle())
                finally:
                    httpd.shutdown()
                    httpd.server_close()
                    thread.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
