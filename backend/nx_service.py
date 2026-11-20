"""Resolve Siemens NX and convert native PRT or JT geometry to STL."""

import json
import math
import os
import re
import shutil
import struct
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JOURNAL = ROOT / "nx" / "export_stl.py"
TIMEOUT_SECONDS = 600
LOG_DIRECTORY = Path(tempfile.gettempdir()) / "NX_3D_Viewer" / "logs"


def _safe_text(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value or "")


def _inspect_stl(path):
    """Report STL validity using the same binary/ASCII assumptions as the browser."""
    result = {"valid": False, "format": "unknown", "triangles": 0, "bytes": 0, "reason": ""}
    try:
        if not path.is_file():
            result["reason"] = "STL file was not created"
            return result
        result["bytes"] = path.stat().st_size
        if result["bytes"] > 256 * 1024 * 1024:
            result["reason"] = "STL exceeds the browser's 256 MB limit"
            return result
        with path.open("rb") as stream:
            first = stream.read(84)
        binary_reason = "STL is smaller than the binary header (84 bytes)"
        if len(first) >= 84:
            count = struct.unpack_from("<I", first, 80)[0]
            expected = 84 + 50 * count
            if count > 0 and expected == result["bytes"]:
                if count > 1_000_000:
                    result["reason"] = "STL exceeds the browser's 1,000,000-triangle limit"
                    return result
                result.update(valid=True, format="binary", triangles=count, reason="valid binary STL")
                return result
            binary_reason = (
                "binary triangle count is " + str(count) + ", expected " +
                str(expected) + " bytes, actual " + str(result["bytes"]) + " bytes"
            )
        # Some NX versions/plugins produce ASCII despite requesting binary STL.
        # The browser already supports that form, provided it contains complete facets.
        if first.lstrip().lower().startswith(b"solid") and b"\0" not in first:
            result["format"] = "ascii"
            number = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
            vertex_line = re.compile(r"^\s*vertex\s+" + number + r"\s+" + number +
                                     r"\s+" + number + r"\s*$", re.IGNORECASE)
            count = 0
            try:
                with path.open("r", encoding="utf-8", errors="replace") as stream:
                    for line in stream:
                        if vertex_line.match(line):
                            count += 1
                            if count > 3_000_000:
                                break
            except OSError as error:
                result["reason"] = "could not read ASCII STL: " + str(error)
                return result
            if count > 0 and count % 3 == 0 and count <= 3_000_000:
                result.update(valid=True, triangles=count // 3, reason="valid ASCII STL")
                return result
            result["reason"] = ("ASCII STL has " + str(count) +
                                " vertex records (must be a nonzero multiple of 3)")
            return result
        result["reason"] = binary_reason
        return result
    except OSError as error:
        result["reason"] = "could not inspect STL: " + str(error)
        return result



def _recover_binary_triangle_count(path):
    """Repair an unfinalized binary STL only if the complete facet stream is usable."""
    if not path.is_file():
        return None
    size = path.stat().st_size
    if size <= 84 or size > 256 * 1024 * 1024 or (size - 84) % 50:
        return None
    triangles = (size - 84) // 50
    if not (0 < triangles <= 1_000_000):
        return None
    facet = struct.Struct('<12fH')
    has_surface = False
    with path.open('r+b') as stream:
        header = stream.read(84)
        if len(header) < 84 or struct.unpack_from('<I', header, 80)[0] != 0:
            return None
        for _ in range(triangles):
            data = stream.read(50)
            if len(data) != 50:
                return None
            values = facet.unpack(data)
            coords = values[3:12]
            if not all(math.isfinite(value) for value in coords):
                return None
            a, b, c = coords[0:3], coords[3:6], coords[6:9]
            u = [b[i] - a[i] for i in range(3)]
            v = [c[i] - a[i] for i in range(3)]
            area_x = u[1] * v[2] - u[2] * v[1]
            area_y = u[2] * v[0] - u[0] * v[2]
            area_z = u[0] * v[1] - u[1] * v[0]
            if area_x != 0 or area_y != 0 or area_z != 0:
                has_surface = True
        if not has_surface:
            return None
        stream.seek(80)
        stream.write(struct.pack('<I', triangles))
    return triangles


def _recover_export_artifacts(output_path, manifest_path):
    """Repair finished STL payloads and use the full model when a body export is empty."""
    notes = []
    if not _inspect_stl(output_path)['valid']:
        count = _recover_binary_triangle_count(output_path)
        if count is not None:
            notes.append('recovered combined STL header from ' + str(count) + ' complete facets')
    if not manifest_path.is_file():
        return notes
    try:
        payload = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, ValueError, TypeError):
        return notes
    if not isinstance(payload, dict) or payload.get('geometryMode') != 'separate':
        return notes
    meshes = payload.get('meshes')
    if not isinstance(meshes, list):
        return notes
    pattern = re.compile(re.escape(output_path.stem) + r'_body_\d{5}\.stl')
    for entry in meshes:
        if not isinstance(entry, dict):
            continue
        name = entry.get('file')
        if not isinstance(name, str) or not pattern.fullmatch(name):
            continue
        body_path = output_path.parent / name
        if not _inspect_stl(body_path)['valid']:
            count = _recover_binary_triangle_count(body_path)
            if count is not None:
                notes.append('recovered ' + name + ' header from ' + str(count) + ' complete facets')
    details = _inspect_manifest(manifest_path, output_path)
    if (not details['valid'] and _inspect_stl(output_path)['valid']
            and isinstance(payload.get('root'), dict)
            and isinstance(payload['root'].get('children'), list)):
        payload['geometryMode'] = 'combined'
        payload['meshes'] = []
        payload['warning'] = ('Some individual NX bodies did not produce geometry. '
                              'The complete model is displayed instead; individual body '
                              'visibility is unavailable.')
        manifest_path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        notes.append('switched hierarchy to complete combined STL: ' + details['reason'])
    return notes


def _inspect_manifest(manifest_path, output_path):
    """Examine hierarchy and every referenced body STL without trusting filenames."""
    details = {"valid": False, "present": manifest_path.is_file(),
               "bytes": 0, "mode": None, "meshes": 0, "bodyFilesValid": False,
               "reason": "manifest file was not created"}
    if not details["present"]:
        return details
    try:
        details["bytes"] = manifest_path.stat().st_size
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        root = payload.get("root")
        if not isinstance(root, dict) or not isinstance(root.get("children"), list):
            details["reason"] = "manifest has no valid root component tree"
            return details
        mode = payload.get("geometryMode", "combined")
        details["mode"] = mode
        if mode not in ("combined", "separate"):
            details["reason"] = "unknown geometry mode: " + str(mode)
            return details
        details["valid"] = True
        if mode == "combined":
            details["bodyFilesValid"] = False
            details["reason"] = "valid combined-geometry manifest"
            return details
        meshes = payload.get("meshes")
        if not isinstance(meshes, list) or not meshes:
            details["valid"] = False
            details["reason"] = "separate mode has no body meshes"
            return details
        details["meshes"] = len(meshes)
        # Geometry actions address occurrence BODY IDs, not source JT
        # prototype names. Every exported mesh must have exactly one matching
        # hierarchy body node, and every body node must have an export.
        body_ids = []
        node_ids = set()

        def collect(node):
            node_id = node.get("id")
            if not isinstance(node_id, str) or not node_id or node_id in node_ids:
                raise ValueError("hierarchy contains missing or duplicate node IDs")
            node_ids.add(node_id)
            if node.get("type") == "body":
                mesh_id = node.get("meshId", node_id)
                if not isinstance(mesh_id, str) or not mesh_id:
                    raise ValueError("hierarchy body has no mesh ID")
                body_ids.append(mesh_id)
            children = node.get("children", [])
            if not isinstance(children, list):
                raise ValueError("hierarchy node has invalid children")
            for child in children:
                if not isinstance(child, dict):
                    raise ValueError("hierarchy contains an invalid child")
                collect(child)

        collect(root)
        exported_ids = [entry.get("id") if isinstance(entry, dict) else None
                        for entry in meshes]
        if (len(set(body_ids)) != len(body_ids)
                or len(set(exported_ids)) != len(exported_ids)
                or set(body_ids) != set(exported_ids)):
            details["valid"] = False
            details["reason"] = ("body mesh IDs do not match the NX assembly hierarchy; "
                                 "individual component controls cannot be safely enabled")
            return details
        for index, entry in enumerate(meshes, 1):
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                details["valid"] = False
                details["reason"] = "body entry " + str(index) + " has no valid id"
                return details
            name = entry.get("file")
            token = re.escape(output_path.stem)
            if not isinstance(name, str) or not re.fullmatch(token + r"_body_\d{5}\.stl", name):
                details["valid"] = False
                details["reason"] = "body entry " + str(index) + " has an invalid file name"
                return details
            item = _inspect_stl(output_path.parent / name)
            if not item["valid"]:
                details["valid"] = False
                details["bodyFilesValid"] = False
                details["reason"] = ("body " + str(index) + "/" + str(len(meshes)) +
                                     " (" + name + "): " + item["reason"])
                return details
        details["bodyFilesValid"] = True
        details["reason"] = "all " + str(len(meshes)) + " body STL files are valid"
        return details
    except (OSError, ValueError, TypeError, AttributeError) as error:
        details["valid"] = False
        details["bodyFilesValid"] = False
        details["reason"] = "cannot parse manifest: " + str(error)
        return details


def _write_diagnostic(path, source, journal_exe, command, env, result=None, exception=None,
                      stage_path=None, error_path=None, output_path=None, manifest_path=None,
                      stl=None, manifest=None, recovery_notes=None):
    """Keep artifact validation details even after the server deletes temporary files."""
    lines = [
        "NX 3D Viewer - conversion diagnostic",
        "Date: " + datetime.now().isoformat(timespec="seconds"),
        "Part: " + str(source),
        "NX executable: " + str(journal_exe),
        "NX_RTS_IRAY (child process): " + str(env.get("NX_RTS_IRAY", "unset")),
        "Command: " + subprocess.list2cmdline(command),
    ]
    if result is not None:
        lines.append("Return code: " + str(result.returncode))
        lines.append("NX stdout:\n" + _safe_text(result.stdout).strip())
        lines.append("NX stderr:\n" + _safe_text(result.stderr).strip())
    if exception is not None:
        lines.append("Launcher error: " + repr(exception))
        if isinstance(exception, subprocess.TimeoutExpired):
            lines.append("NX stdout (partial):\n" + _safe_text(exception.stdout).strip())
            lines.append("NX stderr (partial):\n" + _safe_text(exception.stderr).strip())
    for label, artifact in (("Journal progress", stage_path), ("Journal traceback", error_path)):
        if artifact is not None and artifact.is_file():
            lines.append(label + ":\n" + artifact.read_text(encoding="utf-8", errors="replace"))
    if recovery_notes:
        lines.append('Export recovery:\n' + '\n'.join(recovery_notes))
    if output_path is not None:
        lines.append("Combined STL: " + str(output_path))
        lines.append("Combined STL inspection: " + json.dumps(stl or _inspect_stl(output_path)))
    if manifest_path is not None:
        lines.append("Hierarchy manifest: " + str(manifest_path))
        lines.append("Manifest inspection: " + json.dumps(manifest or _inspect_manifest(manifest_path, output_path)))
    path.write_text("\n\n".join(lines) + "\n", encoding="utf-8")


def _last_stage(stage_path):
    if not stage_path.is_file():
        return None
    values = [line.strip() for line in stage_path.read_text(encoding="utf-8", errors="replace").splitlines()]
    return values[-1] if values else None


def _has_usable_stl(path):
    return _inspect_stl(path)["valid"]


def find_nx_journal():
    candidates = []
    explicit = os.environ.get("NX_RUN_JOURNAL")
    if explicit:
        candidates.append(Path(explicit.strip('"')))

    for key in ("UGII_BASE_DIR", "UGII_ROOT_DIR"):
        value = os.environ.get(key)
        if value:
            root = Path(value.strip('"'))
            candidates.extend((root / "run_journal.exe", root / "NXBIN" / "run_journal.exe",
                               root.parent / "NXBIN" / "run_journal.exe"))

    for key in ("ProgramFiles", "ProgramFiles(x86)"):
        base = os.environ.get(key)
        if base:
            siemens = Path(base) / "Siemens"
            if siemens.is_dir():
                candidates.extend(siemens.glob("NX*/NXBIN/run_journal.exe"))
                candidates.extend(siemens.glob("NX*/run_journal.exe"))

    which = shutil.which("run_journal.exe")
    if which:
        candidates.append(Path(which))

    seen = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        if candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(
        "Siemens NX run_journal.exe was not found. Set NX_RUN_JOURNAL to its full path "
        "(for example, C:\\Program Files\\Siemens\\NX1855\\NXBIN\\run_journal.exe)."
    )


def choose_prt_file():
    """Open a source CAD file; retained name for the existing server interface."""
    from tkinter import Tk, filedialog

    root = Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        root.update()
        return filedialog.askopenfilename(
            parent=root,
            title="Open Siemens NX PRT or JT File",
            filetypes=[("NX part and JT", "*.prt *.jt"), ("NX Part", "*.prt"),
                       ("JT Visualization File", "*.jt")],
        )
    finally:
        root.destroy()


def convert_prt(input_path, output_dir, journal_exe=None):
    """Preserve the existing native-part conversion entry point."""
    return _convert_nx(input_path, output_dir, journal_exe, '.prt')


def convert_jt(input_path, output_dir, journal_exe=None):
    """Open a JT through NX and export any loaded NX solid/sheet bodies as STL.

    JT import requires an installed, licensed NX with JT support. An external
    reference must be resolved by NX in its original relative directory.
    """
    return _convert_nx(input_path, output_dir, journal_exe, '.jt')


def _check_jt_header(source):
    """Reject obvious wrong files before an expensive NX process is launched."""
    with source.open('rb') as stream:
        header = stream.read(90)
    if not re.match(rb'^Version\s+\d+\.\d+\s+JT\b', header):
        raise ValueError('This .jt file does not have a recognizable JT file header.')


def _jt_load_failure(source, details, diagnostic):
    """Give actionable JT recovery steps without exposing NX journal tracebacks."""
    folder = source.parent / source.stem
    filename = source.name
    # Treat a same-stem folder as a common layout, not a mandatory JT property.
    if folder.is_dir():
        advice = ('Check that the companion folder "' + folder.name + '/" contains '
                  'the original referenced JT files and filenames.')
    else:
        advice = ('If this JT uses external components, restore its companion folder '
                  '"' + folder.name + '/" next to "' + filename + '" and upload '
                  'the referenced .jt files inside it.')
    match = re.search(r'JT referenced components could not be loaded:\s*(.+)',
                      details, flags=re.IGNORECASE)
    if match:
        # NX itself identified unloaded parts, which is more reliable than folder heuristics.
        reported = match.group(1).splitlines()[0][:550]
        problem = 'NX reported unloaded JT components: ' + reported + '. '
    else:
        problem = ('NX could not load exportable geometry from JT file "' + filename + '". '
                   'The JT may have missing references, unsupported facet-only geometry, '
                   'or an NX translator issue. ')
    return problem + advice + ' Diagnostic log: ' + str(diagnostic)


def _convert_nx(input_path, output_dir, journal_exe, extension):
    source = Path(input_path).resolve()
    if source.suffix.lower() != extension or not source.is_file():
        raise ValueError('Select an existing Siemens NX ' + extension + ' file.')
    if extension == '.jt':
        _check_jt_header(source)
    if not JOURNAL.is_file():
        raise FileNotFoundError("NX export journal is missing.")

    journal_exe = Path(journal_exe).resolve() if journal_exe else find_nx_journal()
    destination = Path(output_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    output_path = destination / (token + ".stl")
    error_path = destination / (token + ".error.txt")
    manifest_path = destination / (token + ".json")
    stage_path = destination / (token + ".stage.log")
    command = [str(journal_exe), str(JOURNAL), "-args", str(source),
               str(output_path), str(manifest_path), str(stage_path)]

    # The legacy NX Iray+ material migration can interrupt batch processing.
    # Disable it only in the child NX process; respect an explicit user override.
    env = os.environ.copy()
    env.setdefault("NX_RTS_IRAY", "0")
    LOG_DIRECTORY.mkdir(parents=True, exist_ok=True)
    diagnostic = LOG_DIRECTORY / ("nx_export_" +
        datetime.now().strftime("%Y%m%d_%H%M%S_") + token[:8] + ".log")

    result = None
    launch_error = None
    try:
        result = subprocess.run(
            command, cwd=str(journal_exe.parent), capture_output=True, text=True,
            errors="replace", timeout=TIMEOUT_SECONDS,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), env=env,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        launch_error = exc
    finally:
        recovery_notes = []
        if (result is not None and launch_error is None and not error_path.is_file()
                and _last_stage(stage_path) == 'completed NX export'):
            try:
                recovery_notes = _recover_export_artifacts(output_path, manifest_path)
            except (OSError, ValueError, struct.error) as recovery_error:
                recovery_notes = ['recovery could not finish: ' + str(recovery_error)]
        stl_info = _inspect_stl(output_path)
        manifest_info = _inspect_manifest(manifest_path, output_path)
        _write_diagnostic(diagnostic, source, journal_exe, command, env,
                          result=result, exception=launch_error,
                          stage_path=stage_path, error_path=error_path,
                          output_path=output_path, manifest_path=manifest_path,
                          stl=stl_info, manifest=manifest_info,
                          recovery_notes=recovery_notes)

    suffix = " Diagnostic log: " + str(diagnostic)
    stage = _last_stage(stage_path)
    if launch_error is not None:
        if isinstance(launch_error, subprocess.TimeoutExpired):
            raise RuntimeError(
                "NX conversion timed out after 10 minutes. If an NX dialog is open, "
                "dismiss it and select 'Don't display this message again', then retry. "
                + ("Last stage: " + stage + ". " if stage else "") + suffix
            ) from launch_error
        raise RuntimeError("NX journal could not be launched: " + str(launch_error) + "." + suffix) from launch_error

    if error_path.is_file():
        details = error_path.read_text(encoding="utf-8", errors="replace").strip()
        if extension == '.jt':
            raise RuntimeError(_jt_load_failure(source, details, diagnostic))
        raise RuntimeError("NX could not export this CAD file: " + details[-1500:] + "." + suffix)
    # NX may exit with a nonzero status during shutdown even after a complete export.
    # Only accept a completed journal and a usable, validated manifest with geometry.
    # A valid collection of separate body meshes can be rendered without a combined STL.
    separate_ok = (manifest_info["valid"] and manifest_info["mode"] == "separate"
                   and manifest_info["bodyFilesValid"])
    usable_geometry = stl_info["valid"] or separate_ok
    if result.returncode != 0:
        if stage == "completed NX export" and usable_geometry and manifest_info["valid"]:
            return output_path
        details = (result.stderr or result.stdout or "").strip()
        if not details:
            details = "NX exited with code " + str(result.returncode)
        if stage:
            details += "; last journal stage: " + stage
        if not usable_geometry:
            details += "; combined STL: " + stl_info["reason"]
            if manifest_info["mode"] == "separate":
                details += "; body geometry: " + manifest_info["reason"]
        if not manifest_info["valid"]:
            details += "; hierarchy: " + manifest_info["reason"]
        if extension == '.jt' and not usable_geometry:
            raise RuntimeError(_jt_load_failure(source, details, diagnostic))
        raise RuntimeError("NX conversion failed: " + details[-1500:] + "." + suffix)
    if not usable_geometry:
        if extension == '.jt':
            raise RuntimeError(_jt_load_failure(source, stl_info['reason'], diagnostic))
        raise RuntimeError("NX completed without usable STL geometry: " + stl_info["reason"] +
                           ". Check that NX can load solid or sheet geometry from the file." + suffix)
    if manifest_info["present"] and not manifest_info["valid"]:
        raise RuntimeError("NX produced an invalid hierarchy manifest: " + manifest_info["reason"] +
                           "." + suffix)
    return output_path
