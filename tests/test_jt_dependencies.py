"""MS41: JT missing-reference handling, safe folder deletion, NX error surfaces."""
import importlib.util
import json
import sys
import tempfile
import threading
import types
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend import nx_service, server, workspace

JT_HEADER = b'Version 10.3 JT  DM 9.2.2.0'.ljust(80, b' ') + b'\n\r\n' + b'\0' * 100


class JtDependencyTests(unittest.TestCase):
    def test_folder_and_parent_are_deleted_as_one_reviewed_package(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(workspace, 'ROOT', Path(folder)):
            root = Path(folder)
            (root / 'Bolt_M12x55.jt').write_bytes(JT_HEADER)
            (root / 'Bolt_M12x55').mkdir()
            (root / 'Bolt_M12x55' / 'Bolt_M12x55_303.jt').write_bytes(JT_HEADER)
            for selected in ('Bolt_M12x55', 'Bolt_M12x55.jt'):
                plan = workspace.deletion_plan(selected)
                self.assertTrue(plan['package'])
                self.assertEqual({item['path'] for item in plan['items']},
                                 {'Bolt_M12x55', 'Bolt_M12x55.jt'})
            with self.assertRaises(workspace.WorkspaceDependencyWarning):
                workspace.delete('Bolt_M12x55', force=True)
            with self.assertRaises(workspace.WorkspaceDependencyWarning):
                workspace.delete('Bolt_M12x55.jt')
            with self.assertRaises(workspace.WorkspaceDependencyWarning):
                workspace.delete_package('Bolt_M12x55', ['Bolt_M12x55'])
            self.assertTrue((root/'Bolt_M12x55').exists())
            result = workspace.delete_package('Bolt_M12x55',
                [item['path'] for item in workspace.deletion_plan('Bolt_M12x55')['items']])
            self.assertEqual(len(result['deleted']), 2)
            self.assertFalse((root / 'Bolt_M12x55').exists())
            self.assertFalse((root / 'Bolt_M12x55.jt').exists())

    def test_nested_folder_and_unrelated_standalone_file(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(workspace, 'ROOT', Path(folder)):
            root = Path(folder)
            (root / 'assembly').mkdir()
            (root / 'assembly' / 'BOLT.jt').write_bytes(JT_HEADER)
            (root / 'assembly' / 'bolt').mkdir()
            (root / 'assembly' / 'unrelated').mkdir()
            workspace.delete('assembly/unrelated')
            with self.assertRaises(workspace.WorkspaceDependencyWarning):
                workspace.delete('assembly/bolt')
            standalone = root/'Standalone.jt'
            standalone.write_bytes(JT_HEADER)
            self.assertEqual(len(workspace.deletion_plan('Standalone.jt')['items']), 1)
            workspace.delete('Standalone.jt')
            self.assertFalse(standalone.exists())
            workspace.delete('assembly')
            self.assertFalse((root / 'assembly').exists())

    def test_http_preview_reject_mismatched_review_and_delete_whole_package(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(workspace, 'ROOT', Path(folder)):
            root = Path(folder)
            (root / 'Bolt_M12x55.jt').write_bytes(JT_HEADER)
            (root / 'Bolt_M12x55').mkdir()
            (root / 'Bolt_M12x55' / 'component.jt').write_bytes(JT_HEADER)
            httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ViewerHandler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                host = f'http://127.0.0.1:{httpd.server_port}'
                def call(path, method='GET', data=None):
                    headers = {'Origin': host}
                    if data is not None: headers['Content-Type'] = 'application/json'
                    req = Request(host + path, method=method, data=data, headers=headers)
                    try:
                        with urlopen(req, timeout=5) as response:
                            return response.status, json.load(response)
                    except HTTPError as error:
                        return error.code, json.load(error)
                status, plan = call('/api/workspace/delete-plan?path=Bolt_M12x55')
                self.assertEqual(status, 200)
                self.assertEqual(len(plan['items']), 2)
                status, result = call('/api/workspace?path=Bolt_M12x55', method='DELETE')
                self.assertEqual(status, 409)
                status, result = call('/api/workspace?path=Bolt_M12x55&force=1', method='DELETE')
                self.assertEqual(status, 409)
                self.assertTrue((root / 'Bolt_M12x55.jt').exists())
                payload = lambda paths: json.dumps({'path':'Bolt_M12x55', 'expectedPaths': paths}).encode()
                status, result = call('/api/workspace/delete-package', 'POST', payload(['Bolt_M12x55']))
                self.assertEqual(status, 409)
                self.assertTrue((root / 'Bolt_M12x55').is_dir())
                status, result = call('/api/workspace/delete-package', 'POST',
                    payload([entry['path'] for entry in plan['items']]))
                self.assertEqual(status, 200)
                self.assertEqual(len(result['deleted']), 2)
                self.assertFalse((root / 'Bolt_M12x55.jt').exists())
                self.assertFalse((root / 'Bolt_M12x55').exists())
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)

    def test_nx_conversion_missing_reference_friendly_error_without_traceback(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parent = root / 'Bolt_M12x55.jt'
            parent.write_bytes(JT_HEADER)
            journal = root / 'run_journal.exe'
            journal.write_bytes(b'fake')
            def fake_nx(command, **kwargs):
                Path(command[4]).with_suffix('.error.txt').write_text(
                    'Traceback (most recent call last):\n'
                    ' File "C:\\Users\\Admin\\nx\\export_stl.py", line 99\n'
                    'RuntimeError: No NX solid or sheet bodies were found.\n')
                return types.SimpleNamespace(returncode=1, stdout='', stderr='')
            with patch.object(nx_service.subprocess, 'run', side_effect=fake_nx):
                with self.assertRaises(RuntimeError) as error:
                    nx_service.convert_jt(parent, root / 'exports', journal)
            message = str(error.exception)
            self.assertIn('Bolt_M12x55/', message)
            self.assertIn('referenced .jt files', message)
            self.assertIn('Diagnostic log', message)
            self.assertNotIn('Traceback', message)
            self.assertNotIn('export_stl.py', message)
            self.assertNotIn('line 99', message)
            self.assertEqual(parent.read_bytes(), JT_HEADER)

    def test_nx_explicit_unloaded_component_names_and_folder_present(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'Bolt_M12x55.jt'
            source.write_bytes(JT_HEADER)
            (root / 'Bolt_M12x55').mkdir()
            journal = root / 'run_journal.exe'
            journal.write_bytes(b'fake')
            def fake_nx(command, **kwargs):
                Path(command[4]).with_suffix('.error.txt').write_text(
                    'RuntimeError: JT referenced components could not be loaded: '
                    'Bolt_M12x55_303.jt: File not found\n')
                return types.SimpleNamespace(returncode=1, stdout='', stderr='')
            with patch.object(nx_service.subprocess, 'run', side_effect=fake_nx):
                with self.assertRaises(RuntimeError) as error:
                    nx_service.convert_jt(source, root / 'exports', journal)
            message = str(error.exception)
            self.assertIn('Bolt_M12x55_303.jt', message)
            self.assertIn('companion folder', message)
            self.assertNotIn('Traceback', message)

    def test_nx_open_journal_detects_unloaded_components_and_disposes_status(self):
        journal_path = Path(__file__).resolve().parents[1] / 'nx' / 'export_stl.py'
        spec = importlib.util.spec_from_file_location('jt_deps_journal', journal_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        disposed = []
        status = types.SimpleNamespace(NumberUnloadedParts=1,
                    GetPartName=lambda index: 'Bolt_M12x55_303.jt',
                    GetStatusDescription=lambda index: 'File missing',
                    Dispose=lambda: disposed.append(True))
        part = types.SimpleNamespace(Bodies=[], ComponentAssembly=None, Name='Root')
        session = types.SimpleNamespace(Parts=types.SimpleNamespace(
            OpenBaseDisplay=lambda path: (part, status)))
        fake_nx = types.SimpleNamespace(Session=types.SimpleNamespace(GetSession=lambda: session))
        with tempfile.TemporaryDirectory() as folder, patch.dict(sys.modules, {'NXOpen': fake_nx}):
            with self.assertRaisesRegex(RuntimeError, 'Bolt_M12x55_303.jt'):
                module.export(str(Path(folder) / 'Bolt_M12x55.jt'),
                              str(Path(folder) / 'test.stl'))
        self.assertEqual(disposed, [True])


if __name__ == '__main__':
    unittest.main()
