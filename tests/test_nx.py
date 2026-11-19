"""Validate NX export orchestration and local model endpoints."""

import json
import struct
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend import nx_service, server


def triangle_stl():
    return (b'NX example' + b'\0' * (80 - len(b'NX example')) + struct.pack('<I', 1) +
            struct.pack('<12fH', 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0))


class NXServiceTests(unittest.TestCase):
    def test_select_existing_prt_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'piece.txt'
            source.write_text('x')
            with self.assertRaises(ValueError):
                nx_service.convert_prt(source, tmp, journal_exe='/does/not/matter')

    def test_nx_journal_stl_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            part = Path(tmp) / 'fixture.prt'
            part.write_bytes(b'NX fake source')
            program = Path(tmp) / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                self.assertEqual('-args', command[2])
                self.assertEqual(str(part), command[3])
                Path(command[4]).write_bytes(triangle_stl())
                return type('Completed', (), {'returncode': 0, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                output = nx_service.convert_prt(part, tmp, program)
            self.assertTrue(output.is_file())
            self.assertEqual(len(triangle_stl()), output.stat().st_size)
            self.assertEqual('.stl', output.suffix)

    def test_nx_journal_reports_error_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            part = Path(tmp) / 'fixture.prt'
            part.write_bytes(b'NX fake source')
            program = Path(tmp) / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                Path(command[4]).with_suffix('.error.txt').write_text('No loaded bodies')
                return type('Completed', (), {'returncode': 0, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                with self.assertRaisesRegex(RuntimeError, 'No loaded bodies'):
                    nx_service.convert_prt(part, tmp, program)


class NXAPITests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        server.ViewerHandler.export_directory = Path(self.temporary.name)
        server.ViewerHandler.assets = {}
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ViewerHandler)
        self.worker = Thread(target=self.httpd.serve_forever, daemon=True)
        self.worker.start()
        self.base = f'http://127.0.0.1:{self.httpd.server_port}'

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.worker.join(timeout=4)
        self.temporary.cleanup()
        server.ViewerHandler.export_directory = None
        server.ViewerHandler.assets = {}

    def test_open_file_returns_downloadable_stl(self):
        def convert(*args):
            path = server.ViewerHandler.export_directory / 'fake.stl'
            path.write_bytes(triangle_stl())
            return path
        with patch.object(server, 'find_nx_journal', return_value=Path('run_journal.exe')), \
             patch.object(server, 'choose_prt_file', return_value='C:/models/housing.prt'), \
             patch.object(server, 'convert_prt', side_effect=convert):
            request = Request(self.base + '/api/open', data=b'', method='POST',
                              headers={'Origin': self.base})
            with urlopen(request, timeout=4) as reply:
                data = json.load(reply)
                self.assertEqual(200, reply.status)
        self.assertTrue(data['ok'])
        self.assertEqual('housing.prt', data['name'])
        with urlopen(self.base + data['modelUrl'], timeout=4) as reply:
            self.assertEqual(triangle_stl(), reply.read())
            self.assertEqual('model/stl', reply.headers['Content-Type'])

    def test_open_file_returns_real_hierarchy_and_body_meshes(self):
        token = 'a' * 32
        manifest_root = {
            'id': 'root', 'name': 'assembly.prt', 'type': 'part', 'children': [
                {'id': 'root_c1', 'name': 'Bolt A', 'type': 'component', 'children': [
                    {'id': 'root_c1_b1', 'name': 'Body 1', 'type': 'body',
                     'meshId': 'root_c1_b1', 'children': []}]},
                {'id': 'root_c2', 'name': 'Bolt B', 'type': 'component', 'children': [
                    {'id': 'root_c2_b1', 'name': 'Body 1', 'type': 'body',
                     'meshId': 'root_c2_b1', 'children': []}]},
            ],
        }
        def convert(*args):
            base = server.ViewerHandler.export_directory
            output = base / (token + '.stl')
            output.write_bytes(triangle_stl())
            entries = []
            for index, node_id in enumerate(('root_c1_b1', 'root_c2_b1'), 1):
                filename = f'{token}_body_{index:05d}.stl'
                (base / filename).write_bytes(triangle_stl())
                entries.append({'id': node_id, 'file': filename})
            output.with_suffix('.json').write_text(json.dumps({
                'root': manifest_root, 'geometryMode': 'separate', 'meshes': entries,
            }), encoding='utf-8')
            return output
        with patch.object(server, 'find_nx_journal', return_value=Path('run_journal.exe')), \
             patch.object(server, 'choose_prt_file', return_value='C:/models/assembly.prt'), \
             patch.object(server, 'convert_prt', side_effect=convert):
            request = Request(self.base + '/api/open', data=b'', method='POST',
                              headers={'Origin': self.base})
            with urlopen(request, timeout=4) as reply:
                response = json.load(reply)
        self.assertEqual('separate', response['geometryMode'])
        self.assertEqual(2, len(response['tree']['children']))
        self.assertEqual(['Bolt A', 'Bolt B'], [n['name'] for n in response['tree']['children']])
        self.assertEqual(2, len(response['meshes']))
        for mesh in response['meshes']:
            with urlopen(self.base + mesh['url'], timeout=4) as reply:
                self.assertEqual(triangle_stl(), reply.read())

    def test_external_origin_is_rejected(self):
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(self.base + '/api/open', data=b'', method='POST',
                            headers={'Origin': 'http://evil.example'}), timeout=4)
        self.assertEqual(403, caught.exception.code)

    def test_nonregistered_models_not_served(self):
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.base + '/api/models/missing.stl', timeout=4)
        self.assertEqual(404, caught.exception.code)

    def test_missing_nx_reports_error(self):
        with patch.object(server, 'find_nx_journal', side_effect=FileNotFoundError('NX not found')):
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.base + '/api/open', data=b'', method='POST'), timeout=4)
        self.assertEqual(500, caught.exception.code)
        self.assertIn('NX not found', caught.exception.read().decode())


if __name__ == '__main__':
    unittest.main()
