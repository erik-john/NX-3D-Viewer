"""Validate NX export orchestration and local model endpoints."""

import json
import os
import struct
import subprocess
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


    def test_legacy_iray_conversion_disabled_only_in_child_and_logs_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'DIN6885 keyway.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            observed = {}
            def exporter(command, **kwargs):
                observed['env'] = kwargs['env'].copy()
                self.assertEqual(str(part), command[3])
                self.assertEqual(7, len(command))
                Path(command[6]).write_text('opening NX part\nexporting combined STL geometry\ncompleted NX export\n')
                Path(command[4]).write_bytes(triangle_stl())
                return type('Completed', (), {'returncode': 0, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.dict(os.environ, {}, clear=True), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                exported = nx_service.convert_prt(part, directory, program)
            self.assertEqual('0', observed['env']['NX_RTS_IRAY'])
            self.assertEqual(triangle_stl(), exported.read_bytes())
            logs = list((directory / 'logs').glob('nx_export_*.log'))
            self.assertEqual(1, len(logs))
            diagnostic = logs[0].read_text()
            self.assertIn('completed NX export', diagnostic)
            self.assertIn('NX_RTS_IRAY (child process): 0', diagnostic)

    def test_existing_iray_preference_is_respected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'legacy.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                self.assertEqual('1', kwargs['env']['NX_RTS_IRAY'])
                Path(command[4]).write_bytes(triangle_stl())
                return type('Completed', (), {'returncode': 0, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.dict(os.environ, {'NX_RTS_IRAY': '1'}), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                nx_service.convert_prt(part, directory, program)

    def test_silent_nx_exit_returns_code_stage_and_persistent_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'legacy.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                Path(command[6]).write_text('opening NX part\n', encoding='utf-8')
                return type('Completed', (), {'returncode': 9, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                with self.assertRaisesRegex(RuntimeError, 'NX exited with code 9') as caught:
                    nx_service.convert_prt(part, directory, program)
            self.assertNotIn('No further information', str(caught.exception))
            self.assertIn('opening NX part', str(caught.exception))
            self.assertIn(str(directory / 'logs'), str(caught.exception))
            logs = list((directory / 'logs').glob('nx_export_*.log'))
            self.assertEqual(1, len(logs))
            diagnostic = logs[0].read_text()
            self.assertIn('Return code: 9', diagnostic)
            self.assertIn('opening NX part', diagnostic)

    def test_nx_timeout_preserves_diagnostic_and_suggests_manual_dialog(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'legacy.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                Path(command[6]).write_text('opening NX part\n', encoding='utf-8')
                raise subprocess.TimeoutExpired(command, timeout=600, output=b'NX waiting')
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                with self.assertRaisesRegex(RuntimeError, 'NX conversion timed out') as caught:
                    nx_service.convert_prt(part, directory, program)
            self.assertIn('opening NX part', str(caught.exception))
            self.assertIn('NX waiting', list((directory / 'logs').glob('nx_export_*.log'))[0].read_text())

    def test_completed_export_survives_nx_shutdown_exit_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'legacy.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                Path(command[4]).write_bytes(triangle_stl())
                Path(command[5]).write_text('{"root":{"id":"root","children":[]},"geometryMode":"combined"}')
                Path(command[6]).write_text('opening NX part\ncompleted NX export\n')
                return type('Completed', (), {'returncode': 5, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                output = nx_service.convert_prt(part, directory, program)
            self.assertEqual(triangle_stl(), output.read_bytes())
            self.assertIn('Return code: 5',
                list((directory / 'logs').glob('nx_export_*.log'))[0].read_text())

    def test_truncated_binary_stl_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'legacy.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                Path(command[4]).write_bytes(triangle_stl()[:-10])
                return type('Completed', (), {'returncode': 0, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                with self.assertRaisesRegex(RuntimeError, 'without usable STL'):
                    nx_service.convert_prt(part, directory, program)


    def test_ascii_stl_recognized_after_completed_nx_exit_code_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'DIN6885 keyway.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            ascii_stl = (b'solid NX\nfacet normal 0 0 1\n outer loop\n'
                         b'vertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\n'
                         b'endloop\nendfacet\nendsolid NX\n')
            def exporter(command, **kwargs):
                Path(command[4]).write_bytes(ascii_stl)
                Path(command[5]).write_text(
                    '{"root":{"id":"root","children":[]},"geometryMode":"combined"}')
                Path(command[6]).write_text('opening NX part\ncompleted NX export\n')
                return type('Completed', (), {'returncode': 1, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                output = nx_service.convert_prt(part, directory, program)
            self.assertEqual(ascii_stl, output.read_bytes())
            log = next((directory / 'logs').glob('nx_export_*.log')).read_text()
            self.assertIn('"format": "ascii"', log)
            self.assertIn('"triangles": 1', log)
            self.assertIn('"valid": true', log)

    def test_nonzero_exit_reports_invalid_binary_triangle_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'DIN6885 keyway.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                Path(command[4]).write_bytes(b'NX STL' + b'\0' * 75 + struct.pack('<I', 0))
                Path(command[5]).write_text(
                    '{"root":{"id":"root","children":[]},"geometryMode":"combined"}')
                Path(command[6]).write_text('opening NX part\ncompleted NX export\n')
                return type('Completed', (), {'returncode': 1, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                with self.assertRaisesRegex(RuntimeError, 'binary triangle count is 0'):
                    nx_service.convert_prt(part, directory, program)
            log = next((directory / 'logs').glob('nx_export_*.log')).read_text()
            self.assertIn('"triangles": 0', log)
            self.assertIn('"valid": false', log)
            self.assertIn('"valid": true', log)  # manifest is structurally valid

    def test_missing_manifest_reported_for_complete_journal_with_nx_exit_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'legacy.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                Path(command[4]).write_bytes(triangle_stl())
                Path(command[6]).write_text('completed NX export\n')
                return type('Completed', (), {'returncode': 1, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                with self.assertRaisesRegex(RuntimeError, 'hierarchy: manifest file was not created'):
                    nx_service.convert_prt(part, directory, program)
            self.assertIn('"present": false', next((directory / 'logs').glob('*.log')).read_text())

    def test_separate_mesh_geometry_can_be_used_when_combined_is_invalid(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'legacy.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                combined = Path(command[4])
                combined.write_bytes(b'bad STL')
                body_name = combined.stem + '_body_00001.stl'
                (combined.parent / body_name).write_bytes(triangle_stl())
                Path(command[5]).write_text(json.dumps({
                    'root': {'id':'root','children':[{'id':'root_b1','name':'Body','type':'body',
                                                     'meshId':'root_b1','children':[]}]},
                    'geometryMode':'separate','meshes':[{'id':'root_b1','file':body_name}]
                }))
                Path(command[6]).write_text('completed NX export\n')
                return type('Completed', (), {'returncode': 1, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                output = nx_service.convert_prt(part, directory, program)
            self.assertTrue(output.with_suffix('.json').exists())
            log = next((directory / 'logs').glob('*.log')).read_text()
            self.assertIn('"bodyFilesValid": true', log)

    def test_separate_mesh_invalid_file_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            part = directory / 'legacy.prt'
            part.write_bytes(b'fake NX data')
            program = directory / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            def exporter(command, **kwargs):
                combined = Path(command[4])
                combined.write_bytes(b'bad STL')
                body_name = combined.stem + '_body_00001.stl'
                (combined.parent / body_name).write_bytes(b'broken')
                Path(command[5]).write_text(json.dumps({
                    'root': {'id':'root','children':[{'id':'root_b1','type':'body','meshId':'root_b1','children':[]}]},
                    'geometryMode':'separate','meshes':[{'id':'root_b1','file':body_name}]
                }))
                Path(command[6]).write_text('completed NX export\n')
                return type('Completed', (), {'returncode': 1, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', directory / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                with self.assertRaisesRegex(RuntimeError, 'body geometry: body 1/1'):
                    nx_service.convert_prt(part, directory, program)


    def test_keyway_completed_nx_zero_count_combined_and_empty_body_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            part = root / 'DIN6885 keyway.prt'
            part.write_bytes(b'NX example source')
            program = root / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            facet = struct.pack('<12fH', 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)

            def exporter(command, **kwargs):
                combined = Path(command[4])
                combined.write_bytes(b'NX binary STL'.ljust(80, b'\0') +
                                     struct.pack('<I', 0) + facet * 494)
                self.assertEqual(24784, combined.stat().st_size)
                bodies = []
                for i in (1, 2, 3):
                    name = combined.stem + '_body_{:05d}.stl'.format(i)
                    path = combined.parent / name
                    path.write_bytes(triangle_stl() if i != 3 else b'NX empty'.ljust(80, b'\0') + struct.pack('<I', 0))
                    bodies.append({'id': 'root_b' + str(i), 'file': name})
                Path(command[5]).write_text(json.dumps({
                    'root': {'id': 'root', 'name': 'DIN6885 keyway', 'type': 'part',
                             'children': [{'id': e['id'], 'type': 'body', 'meshId': e['id'],
                                           'name': e['id'], 'children': []} for e in bodies]},
                    'geometryMode': 'separate', 'meshes': bodies,
                }))
                Path(command[6]).write_text('opening NX part\ncompleted NX export\n')
                return type('Completed', (), {'returncode': 1, 'stdout': '', 'stderr': ''})()

            with patch.object(nx_service, 'LOG_DIRECTORY', root / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                output = nx_service.convert_prt(part, root, program)
            data = output.read_bytes()
            self.assertEqual(494, struct.unpack_from('<I', data, 80)[0])
            self.assertEqual(24784, len(data))
            self.assertEqual(494, nx_service._inspect_stl(output)['triangles'])
            manifest = json.loads(output.with_suffix('.json').read_text())
            self.assertEqual('combined', manifest['geometryMode'])
            self.assertEqual([], manifest['meshes'])
            self.assertEqual(3, len(manifest['root']['children']))
            self.assertIn('complete model', manifest['warning'])
            log = next((root / 'logs').glob('*.log')).read_text()
            self.assertIn('recovered combined STL header from 494 complete facets', log)
            self.assertIn('switched hierarchy to complete combined STL', log)
            self.assertIn('"valid": true', log)
            self.assertIn('Return code: 1', log)

    def test_empty_zero_triangle_file_is_not_recovered(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'empty.stl'
            data = b'NX empty'.ljust(80, b'\0') + struct.pack('<I', 0)
            path.write_bytes(data)
            self.assertIsNone(nx_service._recover_binary_triangle_count(path))
            self.assertEqual(data, path.read_bytes())
            self.assertFalse(nx_service._inspect_stl(path)['valid'])

    def test_corrupt_binary_facets_are_not_recovered(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bad.stl'
            header = b'NX bad'.ljust(80, b'\0') + struct.pack('<I', 0)
            facet = struct.pack('<12fH', 0, 0, 1, 0, 0, 0, float('nan'), 0, 0, 0, 1, 0, 0)
            data = header + facet
            path.write_bytes(data)
            self.assertIsNone(nx_service._recover_binary_triangle_count(path))
            self.assertEqual(data, path.read_bytes())

    def test_finished_binary_body_facets_are_recovered_without_combined_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            part = root / 'part.prt'
            part.write_bytes(b'fake NX source')
            program = root / 'run_journal.exe'
            program.write_bytes(b'fake executable')
            facet = struct.pack('<12fH', 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)
            def exporter(command, **kwargs):
                combined = Path(command[4])
                combined.write_bytes(triangle_stl())
                name = combined.stem + '_body_00001.stl'
                (combined.parent / name).write_bytes(b'body'.ljust(80, b'\0') + struct.pack('<I', 0) + facet)
                Path(command[5]).write_text(json.dumps({
                    'root': {'id': 'root', 'children': [{'id':'root_b1','type':'body','meshId':'root_b1','children':[]}]},
                    'geometryMode': 'separate', 'meshes': [{'id': 'root_b1', 'file': name}]}))
                Path(command[6]).write_text('completed NX export\n')
                return type('Completed', (), {'returncode': 1, 'stdout': '', 'stderr': ''})()
            with patch.object(nx_service, 'LOG_DIRECTORY', root / 'logs'), \
                 patch.object(nx_service.subprocess, 'run', side_effect=exporter):
                output = nx_service.convert_prt(part, root, program)
            self.assertEqual('separate', json.loads(output.with_suffix('.json').read_text())['geometryMode'])
            self.assertTrue(nx_service._inspect_manifest(output.with_suffix('.json'), output)['valid'])



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

    def test_inspector_metadata_and_local_file_details(self):
        with tempfile.TemporaryDirectory() as directory:
            selected = Path(directory) / 'gear.prt'
            selected.write_bytes(b'NX local file content')
            def convert(*args):
                output = server.ViewerHandler.export_directory / 'model.stl'
                output.write_bytes(triangle_stl())
                output.with_suffix('.json').write_text(json.dumps({
                    'root': {'id': 'root', 'name': 'Gear', 'type': 'part', 'children': []},
                    'geometryMode': 'combined',
                    'partInfo': {'units': 'in', 'attributes': [
                        {'name': 'Revision', 'value': 'B'}]},
                }), encoding='utf-8')
                return output
            with patch.object(server, 'find_nx_journal', return_value=Path('run_journal.exe')), \
                 patch.object(server, 'choose_prt_file', return_value=str(selected)), \
                 patch.object(server, 'convert_prt', side_effect=convert):
                request = Request(self.base + '/api/open', data=b'', method='POST',
                                  headers={'Origin': self.base})
                with urlopen(request, timeout=4) as reply:
                    data = json.load(reply)
            self.assertEqual(selected.stat().st_size, data['file']['size'])
            self.assertEqual(str(selected), data['file']['path'])
            self.assertRegex(data['file']['modified'], r'^\d{4}-\d{2}-\d{2}')
            self.assertEqual('in', data['nx']['units'])
            self.assertEqual('B', data['nx']['attributes'][0]['value'])

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
