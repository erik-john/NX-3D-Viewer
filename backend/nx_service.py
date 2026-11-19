"""Resolve a local Siemens NX installation and convert a selected part to STL."""

import os
import shutil
import subprocess
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JOURNAL = ROOT / "nx" / "export_stl.py"
TIMEOUT_SECONDS = 600


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
    from tkinter import Tk, filedialog

    root = Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        root.update()
        return filedialog.askopenfilename(
            parent=root,
            title="Open Siemens NX Part",
            filetypes=[("Siemens NX Part", "*.prt")],
        )
    finally:
        root.destroy()


def convert_prt(input_path, output_dir, journal_exe=None):
    source = Path(input_path).resolve()
    if source.suffix.lower() != ".prt" or not source.is_file():
        raise ValueError("Select an existing Siemens NX .prt file.")
    if not JOURNAL.is_file():
        raise FileNotFoundError("NX export journal is missing.")

    journal_exe = Path(journal_exe).resolve() if journal_exe else find_nx_journal()
    destination = Path(output_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    output_path = destination / (token + ".stl")
    error_path = destination / (token + ".error.txt")
    manifest_path = destination / (token + ".json")
    command = [str(journal_exe), str(JOURNAL), "-args", str(source), str(output_path), str(manifest_path)]

    try:
        result = subprocess.run(
            command, cwd=str(journal_exe.parent), capture_output=True, text=True,
            errors="replace", timeout=TIMEOUT_SECONDS,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("NX conversion exceeded 10 minutes. Check NX and the selected part.") from exc

    if error_path.exists():
        details = error_path.read_text(encoding="utf-8", errors="replace").strip()
        raise RuntimeError("NX could not export this part: " + details[-1800:])
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "No further information").strip()
        raise RuntimeError("NX conversion failed: " + detail[-1800:])
    if not output_path.is_file() or output_path.stat().st_size < 84:
        raise RuntimeError("NX completed without creating usable STL geometry. Check that the part contains loaded solid bodies.")
    return output_path
