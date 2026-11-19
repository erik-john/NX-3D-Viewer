"""Serve the local NX 3D Viewer on port 8888."""

import json
from datetime import datetime
import re
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

try:
    from .nx_service import choose_prt_file, convert_prt, find_nx_journal
except ImportError:
    from nx_service import choose_prt_file, convert_prt, find_nx_journal

HOST = "127.0.0.1"
PORT = 8888
FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"
EXPORT_LOCK = threading.Lock()


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

    def valid_request_host(self):
        host = self.headers.get("Host", "")
        return host in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def do_GET(self):
        if not self.valid_request_host():
            return self.send_error_json(403, "Local viewer requests only.")
        path = urlsplit(self.path).path
        if path == "/api/health":
            try:
                find_nx_journal()
                nx_available = True
            except FileNotFoundError:
                nx_available = False
            return self.send_json(200, {"status": "ok", "nxAvailable": nx_available})
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
                    files.append({'id': mesh_id, 'url': '/api/models/' + name})
                    with self.asset_lock:
                        self.assets[name] = mesh_path
                return tree, mode, files, manifest.get('warning', ''), manifest.get('partInfo', {})
        return tree, 'combined', None, manifest.get('warning', ''), manifest.get('partInfo', {})

    def do_POST(self):
        if not self.valid_request_host():
            return self.send_error_json(403, "Local viewer requests only.")
        if urlsplit(self.path).path != "/api/open":
            return self.send_error_json(404, "Unknown endpoint.")
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{self.server.server_port}",
                                     f"http://localhost:{self.server.server_port}"):
            return self.send_error_json(403, "Open files from the local viewer only.")
        if not EXPORT_LOCK.acquire(blocking=False):
            return self.send_error_json(409, "Another NX file is being opened.")
        try:
            nx_journal = find_nx_journal()
            selection = choose_prt_file()
            if not selection:
                return self.send_json(200, {"ok": False, "cancelled": True})
            if self.export_directory is None:
                raise RuntimeError("Model export directory unavailable.")
            output = convert_prt(selection, self.export_directory, nx_journal)
            tree, geometry_mode, files, warning, nx_info = self.prepare_structure(output, Path(selection).name)
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
                "ok": True,
                "name": Path(selection).name,
                "modelUrl": "/api/models/" + output.name,
                "tree": tree,
                "file": file_info,
                "nx": nx_info,
                "geometryMode": geometry_mode,
                "meshes": files,
                "warning": warning,
            })
        except Exception as error:
            return self.send_error_json(500, str(error))
        finally:
            EXPORT_LOCK.release()


def main():
    with tempfile.TemporaryDirectory(prefix="NX_3D_Viewer_") as temporary:
        ViewerHandler.export_directory = Path(temporary)
        ViewerHandler.assets = {}
        try:
            with ThreadingHTTPServer((HOST, PORT), ViewerHandler) as server:
                print("NX 3D Viewer: http://127.0.0.1:8888/")
                try:
                    server.serve_forever(poll_interval=0.2)
                except KeyboardInterrupt:
                    print("\nStopping NX 3D Viewer")
        except OSError as error:
            raise RuntimeError("Port 8888 is already in use. Close the other viewer process.") from error
        finally:
            ViewerHandler.export_directory = None
            ViewerHandler.assets = {}


if __name__ == "__main__":
    main()
