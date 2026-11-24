"""Test local CAD workspace handling and the real HTTP endpoints."""

import io
import json
import os
import tempfile
import threading
import unittest
import zipfile
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from backend import server, workspace


@contextmanager
def running_workspace():
    with tempfile.TemporaryDirectory() as tmp:
        with patch.object(workspace, 'ROOT', Path(tmp) / 'uploads'):
            httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ViewerHandler)
            worker = threading.Thread(target=httpd.serve_forever, daemon=True)
            worker.start()
            try:
                (Path(tmp)/'uploads').mkdir(exist_ok=True)
                yield f'http://127.0.0.1:{httpd.server_port}', Path(tmp) / 'uploads'
            finally:
                httpd.shutdown()
                httpd.server_close()
                worker.join(timeout=4)


def call(url, method='GET', data=None, kind=None):
    headers = {'Origin': f'http://127.0.0.1:{url.split("/")[2].split(":")[-1]}'}
    if kind:
        headers['Content-Type'] = kind
    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=6) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


class WorkspaceTests(unittest.TestCase):
    def test_folder_file_list_delete_via_http(self):
        with running_workspace() as (url, root):
            code, data = call(url + '/api/workspace')
            self.assertEqual((code, data['fileCount']), (200, 0))
            code, _ = call(url + '/api/workspace/folder', 'POST', b'{"path":"Assy"}', 'application/json')
            self.assertEqual(code, 201)
            code, _ = call(url + '/api/workspace/upload?path=Assy%2FTop.prt', 'POST', b'NX-part', 'application/octet-stream')
            self.assertEqual(code, 201)
            self.assertEqual((root / 'Assy' / 'Top.prt').read_bytes(), b'NX-part')
            code, data = call(url + '/api/workspace')
            self.assertEqual(data['fileCount'], 1)
            self.assertIn('Assy/Top.prt', [a['path'] for a in data['files']])
            code, data = call(url + '/api/workspace?path=Assy', 'DELETE')
            self.assertEqual(code, 200)
            self.assertFalse((root / 'Assy').exists())

    def test_upload_duplicate_is_not_replaced(self):
        with running_workspace() as (url, root):
            target = url + '/api/workspace/upload?path=part.prt'
            self.assertEqual(call(target, 'POST', b'one', 'application/octet-stream')[0], 201)
            code, _ = call(target, 'POST', b'two', 'application/octet-stream')
            self.assertEqual(code, 409)
            self.assertEqual((root / 'part.prt').read_bytes(), b'one')
            self.assertEqual(call(target + '&replace=1', 'POST', b'two', 'application/octet-stream')[0], 201)
            self.assertEqual((root / 'part.prt').read_bytes(), b'two')

    def test_reject_path_escape_and_absolute_paths(self):
        with running_workspace() as (url, root):
            for illegal in ['../escape.prt', '/absolute.prt', 'C:/data.prt', 'x\\evil.prt',
                            'a/./b.prt', 'CON.prt', '.gitignore', 'foo//bar.prt']:
                with self.subTest(path=illegal):
                    code, _ = call(url + '/api/workspace/upload?path=' + quote(illegal, safe=''),
                                   'POST', b'bad', 'application/octet-stream')
                    self.assertEqual(code, 400)
            self.assertEqual(list(root.iterdir()), [])

    def test_symlink_path_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(workspace, 'ROOT', Path(tmp)/'uploads'):
                workspace.directory('legit')
                try:
                    (Path(tmp)/'uploads'/'external').symlink_to(Path(tmp), target_is_directory=True)
                except OSError:
                    self.skipTest('No symlink support')
                with self.assertRaisesRegex(workspace.WorkspaceError, 'Symbolic links'):
                    workspace.upload('external/data.prt', io.BytesIO(b'data'), 4)

    def test_file_stream_requires_complete_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(workspace, 'ROOT', Path(tmp)/'uploads'):
                with self.assertRaisesRegex(workspace.WorkspaceError, 'ended before'):
                    workspace.upload('part.prt', io.BytesIO(b'abc'), 123)
                self.assertEqual(list((Path(tmp)/'uploads').iterdir()), [])

    def test_chr_requires_matching_prt_and_valid_nx_file(self):
        valid = b'SPLMSSTR' + b'\0' * 128 + b'CHRPARTS' + b'\0' * 40
        with running_workspace() as (url, root):
            chr_url = url + '/api/workspace/upload?path=Bolt%20M12x55_chr.chr'
            code, response = call(chr_url, 'POST', valid, 'application/octet-stream')
            self.assertEqual(code, 400)
            self.assertIn('matching', response['error'].lower())
            self.assertFalse((root/'Bolt M12x55_chr.chr').exists())
            self.assertEqual(call(url + '/api/workspace/upload?path=Bolt%20M12x55.prt',
                'POST', b'CAD', 'application/octet-stream')[0], 201)
            code, response = call(chr_url, 'POST', b'bad data', 'application/octet-stream')
            self.assertEqual(code, 400)
            self.assertIn('not a recognized NX', response['error'])
            self.assertFalse((root/'Bolt M12x55_chr.chr').exists())
            self.assertEqual(call(chr_url, 'POST', valid, 'application/octet-stream')[0], 201)
            self.assertEqual((root/'Bolt M12x55_chr.chr').read_bytes(), valid)
            code, _ = call(url + '/api/workspace/open', 'POST',
                b'{"path":"Bolt M12x55_chr.chr"}', 'application/json')
            self.assertEqual(code, 400)
            # A failed replacement never destroys an existing valid CHR.
            self.assertEqual(call(chr_url + '&replace=1', 'POST', b'bad',
                'application/octet-stream')[0], 400)
            self.assertEqual((root/'Bolt M12x55_chr.chr').read_bytes(), valid)

    def test_chr_matching_stays_within_same_workspace_folder(self):
        valid = b'SPLMSSTR' + b'\0' * 128 + b'CHRPARTS'
        with running_workspace() as (url, root):
            self.assertEqual(call(url + '/api/workspace/upload?path=Model.prt',
                'POST', b'CAD', 'application/octet-stream')[0], 201)
            self.assertEqual(call(url + '/api/workspace/folder', 'POST',
                b'{"path":"Models"}', 'application/json')[0], 201)
            chr_url = url + '/api/workspace/upload?path=Models%2FModel.chr'
            self.assertEqual(call(chr_url,'POST',valid,'application/octet-stream')[0], 400)
            self.assertEqual(call(url + '/api/workspace/upload?path=Models%2FMODEL.PRT',
                'POST', b'CAD2', 'application/octet-stream')[0], 201)
            self.assertEqual(call(chr_url,'POST',valid,'application/octet-stream')[0], 201)
            self.assertTrue((root/'Models'/'Model.chr').exists())

    def test_zip_extract_preserves_dependent_files(self):
        with running_workspace() as (url, root):
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('Assembly/Main.prt', b'main')
                z.writestr('Assembly/Components/Bearing.prt', b'bearing')
                z.writestr('Assembly/Components/preview.bmp', b'image')
            self.assertEqual(call(url + '/api/workspace/upload?path=Bundle.zip',
                'POST', archive.getvalue(), 'application/octet-stream')[0], 201)
            code, data = call(url + '/api/workspace/extract', 'POST',
                b'{"path":"Bundle.zip"}', 'application/json')
            self.assertEqual(code, 201)
            self.assertEqual(data['files'], 3)
            self.assertEqual((root/'Bundle'/'Assembly'/'Components'/'Bearing.prt').read_bytes(), b'bearing')

    def test_zip_traversal_refused_without_partial_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(workspace, 'ROOT', Path(tmp)/'uploads'):
                archive = io.BytesIO()
                with zipfile.ZipFile(archive, 'w') as z:
                    z.writestr('good.prt', 'okay')
                    z.writestr('../escape.prt', 'bad')
                workspace.upload('Bundle.zip', io.BytesIO(archive.getvalue()), len(archive.getvalue()))
                with self.assertRaises(workspace.WorkspaceError):
                    workspace.extract('Bundle.zip')
                self.assertFalse((Path(tmp)/'uploads'/'Bundle').exists())
                self.assertFalse((Path(tmp)/'escape.prt').exists())

    def test_upload_missing_parent_and_open_wrong_extension(self):
        with running_workspace() as (url, root):
            code, _ = call(url + '/api/workspace/upload?path=other%2Fpart.prt', 'POST',
                           b'data', 'application/octet-stream')
            self.assertEqual(code, 400)
            self.assertEqual(call(url + '/api/workspace/upload?path=docs.txt', 'POST', b'abc', 'application/octet-stream')[0], 201)
            code, _ = call(url + '/api/workspace/open', 'POST', b'{"path":"docs.txt"}', 'application/json')
            self.assertEqual(code, 400)

    def test_foreign_origin_rejected(self):
        with running_workspace() as (url, root):
            request = Request(url + '/api/workspace/upload?path=bad.prt', data=b'data',
                headers={'Origin': 'https://outside.example', 'Content-Type': 'application/octet-stream'}, method='POST')
            with self.assertRaises(HTTPError) as captured:
                urlopen(request, timeout=4)
            self.assertEqual(captured.exception.code, 403)
            self.assertFalse((root / 'bad.prt').exists())

    def test_workspace_open_uses_existing_nx_conversion(self):
        with running_workspace() as (url, root):
            (root/'part.prt').write_bytes(b'CAD')
            from unittest.mock import patch as patched
            import struct
            source_stl = b'Nx' + b'\0' * 78 + struct.pack('<I', 1) + struct.pack('<12fH', 0,0,1,0,0,0,1,0,0,0,1,0,0)
            with tempfile.TemporaryDirectory() as output:
                server.ViewerHandler.export_directory = Path(output)
                def fake_convert(source, directory, journal):
                    self.assertEqual(source, root/'part.prt')
                    result = Path(directory)/'test.stl'
                    result.write_bytes(source_stl)
                    return result
                with patched.object(server, 'find_nx_journal', return_value='mock NX'), \
                     patched.object(server, 'convert_prt', side_effect=fake_convert):
                    status, data = call(url + '/api/workspace/open', 'POST',
                        b'{"path":"part.prt"}', 'application/json')
                self.assertEqual(status, 200)
                self.assertTrue(data['ok'])
                self.assertEqual(data['name'], 'part.prt')
                server.ViewerHandler.export_directory = None
                server.ViewerHandler.assets = {}


if __name__ == '__main__':
    unittest.main()
