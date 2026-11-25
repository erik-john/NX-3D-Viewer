"""Serve NX 3D Viewer locally or on an explicitly selected LAN address."""

import argparse
import ipaddress
import json
import zipfile
from urllib.parse import parse_qs
from datetime import datetime
import re
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

try:
    from . import workspace
    from .nx_service import choose_prt_file, convert_prt, convert_jt, find_nx_journal
except ImportError:
    import workspace
    from nx_service import choose_prt_file, convert_prt, convert_jt, find_nx_journal

HOST = "127.0.0.1"
PORT = 8888
FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"
EXPORT_LOCK = threading.Lock()
LAN_NETWORKS = tuple(ipaddress.IPv4Network(network) for network in (
    '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))


def lan_address(value):
    try:
        address = ipaddress.IPv4Address(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Specify the server's private IPv4 address.") from None
    if not any(address in network for network in LAN_NETWORKS):
        raise argparse.ArgumentTypeError('LAN mode requires a private IPv4 address (10.x, 172.16-31.x, or 192.168.x).')
    return str(address)


class ViewerHandler(SimpleHTTPRequestHandler):
    assets = {}
    asset_lock = threading.Lock()
    export_directory = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_error_json(self, code, message):
        self.send_json(code, {"ok": False, "error": message})

    def is_lan_mode(self):
        return self.server.server_address[0] != HOST

    def valid_mutation_origin(self):
        origins = self.headers.get_all('Origin', [])
        if len(origins) > 1:
            return False
        if origins and origins[0] != 'http://' + self.headers.get('Host', ''):
            return False
        # LAN browser writes must identify this exact origin. Preserve local API clients.
        if self.is_lan_mode() and not origins:
            return False
        return self.headers.get('Sec-Fetch-Site', 'same-origin') in ('same-origin', 'none')

    def read_json(self):
        if not self.headers.get('Content-Type', '').lower().startswith('application/json'):
            raise workspace.WorkspaceError('A JSON request is required.')
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0 or length > 8192:
            raise workspace.WorkspaceError('Invalid request size.')
        payload = json.loads(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise workspace.WorkspaceError('Invalid request body.')
        return payload

    def workspace_error(self, error):
        if isinstance(error, FileExistsError):
            return self.send_error_json(409, str(error))
        if isinstance(error, FileNotFoundError):
            return self.send_error_json(404, str(error))
        if isinstance(error, (ValueError, json.JSONDecodeError, zipfile.BadZipFile)):
            return self.send_error_json(400, str(error))
        return self.send_error_json(500, 'Workspace operation failed: ' + str(error))

    def valid_request_host(self):
        hosts = self.headers.get_all('Host', [])
        if len(hosts) != 1:
            return False
        port = self.server.server_port
        address = self.server.server_address[0]
        if not self.is_lan_mode():
            return hosts[0] in (f'127.0.0.1:{port}', f'localhost:{port}')
        # Never trust arbitrary hostnames or a wildcard bind for LAN access.
        return any(ipaddress.IPv4Address(address) in network for network in LAN_NETWORKS) and hosts[0] == f'{address}:{port}'

    def do_HEAD(self):
        if not self.valid_request_host():
            return self.send_error(403, 'Viewer host is not allowed.')
        return super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def do_GET(self):
        if not self.valid_request_host():
            return self.send_error_json(403, "Viewer host or request origin is not allowed.")
        path = urlsplit(self.path).path
        if path == "/api/health":
            try:
                find_nx_journal()
                nx_available = True
            except FileNotFoundError:
                nx_available = False
            return self.send_json(200, {"status": "ok", "nxAvailable": nx_available})
        if path == '/api/workspace':
            try:
                return self.send_json(200, workspace.listing())
            except (OSError, ValueError) as error:
                return self.workspace_error(error)
        if path == '/api/workspace/delete-plan':
            try:
                params = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                if set(params) != {'path'} or len(params['path']) != 1:
                    raise workspace.WorkspaceError('Specify one workspace file path.')
                return self.send_json(200, workspace.deletion_plan(params['path'][0]))
            except (OSError, ValueError) as error:
                return self.workspace_error(error)
        if path.startswith("/api/models/"):
            name = path[len("/api/models/"):]
            if not name or "/" in name or "\\" in name or not name.endswith(".stl"):
                return self.send_error_json(404, "Model not found.")
            with self.asset_lock:
                asset_path = self.assets.get(name)
            if asset_path is None or not asset_path.is_file():
                return self.send_error_json(404, "Model not found.")
            size = asset_path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "model/stl")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            try:
                with asset_path.open("rb") as stream:
                    while data := stream.read(1024 * 1024):
                        self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if path.startswith("/api/"):
            return self.send_error_json(404, "Unknown endpoint.")
        return super().do_GET()

    def prepare_structure(self, output, display_name):
        manifest_path = output.with_suffix('.json')
        default = {'id': 'root', 'name': display_name, 'type': 'part', 'children': [],
                   'meshId': 'root'}
        if not manifest_path.is_file():
            return default, 'combined', None, '', {}
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        tree = manifest.get('root')
        if not isinstance(tree, dict) or not isinstance(tree.get('children'), list):
            raise RuntimeError('NX returned an invalid component structure.')
        mode = manifest.get('geometryMode', 'combined')
        if mode == 'separate':
            meshes = manifest.get('meshes', [])
            if not meshes:
                mode = 'combined'
            else:
                files = []
                for item in meshes:
                    name, mesh_id = item.get('file'), item.get('id')
                    if not isinstance(name, str) or not re.fullmatch(r'[0-9a-f]{32}_body_\d{5}\.stl', name):
                        raise RuntimeError('NX returned an invalid geometry file name.')
                    mesh_path = output.parent / name
                    if not mesh_path.is_file():
                        raise RuntimeError('NX body geometry is missing: ' + name)
                    entry = {'id': mesh_id, 'url': '/api/models/' + name}
                    # Only per-body NX geometry can be associated with CAD faces.
                    if isinstance(item.get('analyticalFaces'), list):
                        entry['analyticalFaces'] = item['analyticalFaces']
                    files.append(entry)
                    with self.asset_lock:
                        self.assets[name] = mesh_path
                return tree, mode, files, manifest.get('warning', ''), manifest.get('partInfo', {})
        return tree, 'combined', None, manifest.get('warning', ''), manifest.get('partInfo', {})

    def convert_and_respond(self, selection):
        if self.export_directory is None:
            raise RuntimeError("Model export directory unavailable.")
        nx_journal = find_nx_journal()
        source = Path(selection)
        if source.suffix.lower() == '.jt':
            output = convert_jt(selection, self.export_directory, nx_journal)
        else:
            output = convert_prt(selection, self.export_directory, nx_journal)
        tree, geometry_mode, files, warning, nx_info = self.prepare_structure(output, Path(selection).name)
        annotations = {}
        try:
            manifest = json.loads(output.with_suffix('.json').read_text(encoding='utf-8'))
            if isinstance(manifest.get('annotations'), dict):
                annotations = manifest['annotations']
        except (OSError, ValueError, TypeError):
            pass
        source = Path(selection)
        file_info = {'path': str(source)}
        try:
            stat = source.stat()
            file_info['size'] = stat.st_size
            file_info['modified'] = datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M')
        except OSError:
            pass
        if not isinstance(nx_info, dict):
            nx_info = {}
        nx_info = {'units': nx_info.get('units'), 'attributes': nx_info.get('attributes', [])}
        with self.asset_lock:
            self.assets[output.name] = output
        return self.send_json(200, {
            "ok": True, "name": source.name,
            "modelUrl": "/api/models/" + output.name,
            "tree": tree, "file": file_info, "nx": nx_info,
            "annotations": annotations,
            "geometryMode": geometry_mode, "meshes": files, "warning": warning,
        })

    def do_POST(self):
        if not self.valid_request_host():
            return self.send_error_json(403, "Viewer host or request origin is not allowed.")
        if not self.valid_mutation_origin():
            return self.send_error_json(403, "Workspace requests must originate from this viewer.")
        parsed = urlsplit(self.path)
        path = parsed.path
        if path == '/api/open':
            if self.is_lan_mode():
                return self.send_error_json(403, 'Use Workspace to upload and open CAD files in LAN mode.')
            if not EXPORT_LOCK.acquire(blocking=False):
                return self.send_error_json(409, 'Another NX file is being opened.')
            try:
                find_nx_journal()
                selection = choose_prt_file()
                if not selection:
                    return self.send_json(200, {'ok': False, 'cancelled': True})
                return self.convert_and_respond(selection)
            except Exception as error:
                return self.send_error_json(500, str(error))
            finally:
                EXPORT_LOCK.release()
        if path == '/api/workspace/open':
            if not EXPORT_LOCK.acquire(blocking=False):
                return self.send_error_json(409, 'Another NX file is being opened.')
            try:
                selection = workspace.file_for_open(self.read_json().get('path'))
                return self.convert_and_respond(selection)
            except (workspace.WorkspaceError, ValueError, json.JSONDecodeError) as error:
                return self.workspace_error(error)
            except Exception as error:
                return self.send_error_json(500, str(error))
            finally:
                EXPORT_LOCK.release()
        if path == '/api/workspace/delete-package':
            if EXPORT_LOCK.locked():
                return self.send_error_json(409, 'File changes are unavailable while NX is opening a model.')
            try:
                payload = self.read_json()
                return self.send_json(200, workspace.delete_package(
                    payload.get('path'), payload.get('expectedPaths')))
            except workspace.WorkspaceDependencyWarning as error:
                return self.send_json(409, {'ok': False, 'code': 'JT_DEPENDENCY', 'error': str(error)})
            except (OSError, ValueError) as error:
                return self.workspace_error(error)
        if path in ('/api/workspace/upload', '/api/workspace/folder', '/api/workspace/extract'):
            if EXPORT_LOCK.locked():
                return self.send_error_json(409, 'File changes are unavailable while NX is opening a model.')
            try:
                if path == '/api/workspace/upload':
                    params = parse_qs(parsed.query, keep_blank_values=True)
                    if (set(params) - {'path', 'replace'} or 'path' not in params or len(params['path']) != 1 or
                            len(params.get('replace', [])) > 1 or
                            any(value not in ('1',) for value in params.get('replace', []))):
                        raise workspace.WorkspaceError('Specify one workspace file path.')
                    if self.headers.get('Content-Type', '').lower() != 'application/octet-stream':
                        raise workspace.WorkspaceError('Expected a binary file upload.')
                    length = int(self.headers.get('Content-Length', '0'))
                    return self.send_json(201, workspace.upload(params['path'][0], self.rfile, length,
                        overwrite=params.get('replace') == ['1']))
                data = self.read_json()
                if path == '/api/workspace/folder':
                    return self.send_json(201, workspace.directory(data.get('path')))
                return self.send_json(201, workspace.extract(data.get('path')))
            except (OSError, ValueError, zipfile.BadZipFile, EOFError) as error:
                return self.workspace_error(error)
        return self.send_error_json(404, 'Unknown endpoint.')

    def do_DELETE(self):
        if not self.valid_request_host() or not self.valid_mutation_origin():
            return self.send_error_json(403, 'Viewer host or request origin is not allowed.')
        parsed = urlsplit(self.path)
        if parsed.path != '/api/workspace':
            return self.send_error_json(404, 'Unknown endpoint.')
        if EXPORT_LOCK.locked():
            return self.send_error_json(409, 'File changes are unavailable while NX is opening a model.')
        try:
            params = parse_qs(parsed.query, keep_blank_values=True)
            if (set(params) - {'path', 'force'} or len(params.get('path', [])) != 1 or
                    params.get('force', []) not in ([], ['1'])):
                raise workspace.WorkspaceError('Specify one workspace file path.')
            return self.send_json(200, workspace.delete(
                params['path'][0], force=params.get('force') == ['1']))
        except workspace.WorkspaceDependencyWarning as error:
            return self.send_json(409, {'ok': False, 'error': str(error), 'code': 'JT_DEPENDENCY'})
        except (OSError, ValueError) as error:
            return self.workspace_error(error)


def main():
    parser = argparse.ArgumentParser(description='Start NX 3D Viewer (local by default).')
    parser.add_argument('--lan', type=lan_address, metavar='SERVER_IPV4',
                        help='Bind to this private IPv4 address for trusted LAN clients.')
    args = parser.parse_args()
    bind_host = args.lan or HOST
    with tempfile.TemporaryDirectory(prefix="NX_3D_Viewer_") as temporary:
        ViewerHandler.export_directory = Path(temporary)
        ViewerHandler.assets = {}
        try:
            with ThreadingHTTPServer((bind_host, PORT), ViewerHandler) as server:
                print(f"NX 3D Viewer: http://{bind_host}:{PORT}/", flush=True)
                if args.lan:
                    print('LAN mode: use Workspace to upload/open files. All reachable clients share it.', flush=True)
                    print('No login or TLS: restrict TCP 8888 to trusted clients using the firewall.', flush=True)
                try:
                    server.serve_forever(poll_interval=0.2)
                except KeyboardInterrupt:
                    print("\nStopping NX 3D Viewer")
        except OSError as error:
            raise RuntimeError(f"Cannot listen on {bind_host}:{PORT}. Check the IP address and port: {error}") from error
        finally:
            ViewerHandler.export_directory = None
            ViewerHandler.assets = {}


if __name__ == "__main__":
    main()
