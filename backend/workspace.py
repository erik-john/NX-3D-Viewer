"""Local CAD file workspace, preserving relative paths for related components."""

import os
import re
import shutil
import stat
import threading
import unicodedata
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1] / 'uploads'
MAX_SINGLE_FILE = 512 * 1024 * 1024
MAX_WORKSPACE_BYTES = 2 * 1024 * 1024 * 1024
MAX_FILES = 3000
MAX_DEPTH = 24
CHUNK = 1024 * 1024
INVALID_WINDOWS_CHARS = re.compile(r'[<>:"\\|?*\x00-\x1f]')
WINDOWS_DEVICES = {'CON', 'PRN', 'AUX', 'NUL'} | {
    f'{prefix}{number}' for prefix in ('COM', 'LPT') for number in range(1, 10)
}
LOCK = threading.RLock()


class WorkspaceError(ValueError):
    pass


def _segments(relative, allow_root=False):
    if not isinstance(relative, str) or len(relative) > 1024:
        raise WorkspaceError('Invalid workspace path.')
    relative = unicodedata.normalize('NFC', relative)
    if allow_root and relative == '':
        return ()
    if not relative or relative.startswith('/') or '\\' in relative or '//' in relative:
        raise WorkspaceError('A relative workspace path is required.')
    segments = relative.split('/')
    if len(segments) > MAX_DEPTH:
        raise WorkspaceError('Folder nesting exceeds the workspace limit.')
    for segment in segments:
        if (segment in ('', '.', '..') or segment.startswith('.') or segment.endswith(('.', ' ')) or
                INVALID_WINDOWS_CHARS.search(segment) or len(segment) > 120 or
                segment.split('.', 1)[0].upper() in WINDOWS_DEVICES or
                any(unicodedata.category(ch) == 'Cf' for ch in segment)):
            raise WorkspaceError('Invalid file or folder name: ' + segment[:60])
    return tuple(segments)


def _root():
    if ROOT.is_symlink():
        raise WorkspaceError('The uploads directory cannot be a symbolic link.')
    ROOT.mkdir(parents=True, exist_ok=True)
    return ROOT.resolve()


def resolve(relative, allow_root=False):
    parts = _segments(relative, allow_root)
    base = _root()
    result = base.joinpath(*parts)
    # Symlink traversal is prohibited, even if a link points inside uploads.
    current = base
    for segment in parts:
        current = current / segment
        if current.is_symlink():
            raise WorkspaceError('Symbolic links are not allowed in the file workspace.')
    if not result.resolve().is_relative_to(base):
        raise WorkspaceError('Workspace path is outside uploads.')
    return result


def _scan():
    base = _root()
    items = []
    total = 0
    count = 0
    for directory, dirs, files in os.walk(base, followlinks=False):
        parent = Path(directory)
        dirs[:] = sorted((n for n in dirs if not (parent / n).is_symlink()), key=str.casefold)
        for name, is_dir in [(n, True) for n in dirs] + [(n, False) for n in sorted(files, key=str.casefold)]:
            source = parent / name
            if source.is_symlink() or name == '.gitignore':
                continue
            path = source.relative_to(base).as_posix()
            if len(source.relative_to(base).parts) > MAX_DEPTH:
                continue
            try:
                info = source.stat()
            except OSError:
                continue
            if not is_dir:
                total += info.st_size
                count += 1
            items.append({
                'path': path,
                'name': name,
                'type': 'folder' if is_dir else 'file',
                'size': None if is_dir else info.st_size,
                'modified': datetime.fromtimestamp(info.st_mtime).strftime('%Y-%m-%d %H:%M'),
                'canOpen': not is_dir and source.suffix.lower() == '.prt',
            })
            if len(items) > MAX_FILES * 2:
                raise WorkspaceError('Workspace contains too many items.')
    return items, total, count


def listing():
    with LOCK:
        entries, total, count = _scan()
        return {'ok': True, 'files': entries, 'totalBytes': total, 'fileCount': count}


def directory(relative):
    with LOCK:
        target = resolve(relative)
        if target.exists():
            raise FileExistsError('A file or folder already exists at this location.')
        if not target.parent.is_dir():
            raise WorkspaceError('Parent folder does not exist.')
        target.mkdir()
        return {'ok': True, 'path': relative}


def file_for_open(relative):
    with LOCK:
        target = resolve(relative)
        if not target.is_file() or target.suffix.lower() != '.prt':
            raise WorkspaceError('Choose a .prt file from the uploaded workspace.')
        return target


def upload(relative, source, length, overwrite=False):
    """Stream one browser-uploaded file to disk, then atomically move it into place."""
    with LOCK:
        target = resolve(relative)
        if length <= 0 or length > MAX_SINGLE_FILE:
            raise WorkspaceError('File is empty or exceeds the 512 MB limit.')
        if not target.parent.is_dir():
            raise WorkspaceError('Create the parent folder before uploading files.')
        if target.exists() and not overwrite:
            raise FileExistsError('File already exists: ' + relative)
        if target.is_dir():
            raise WorkspaceError('Cannot replace a folder with a file.')
        _, total, count = _scan()
        previous_size = target.stat().st_size if target.exists() else 0
        if total - previous_size + length > MAX_WORKSPACE_BYTES:
            raise WorkspaceError('The uploads workspace exceeds its 2 GB limit.')
        if count + (0 if target.exists() else 1) > MAX_FILES:
            raise WorkspaceError('The uploads workspace exceeds its file limit.')
        temp = target.with_name('.upload-' + os.urandom(12).hex() + '.tmp')
        try:
            with temp.open('xb') as stream:
                remaining = length
                while remaining:
                    data = source.read(min(CHUNK, remaining))
                    if not data:
                        raise WorkspaceError('The upload ended before all file bytes arrived.')
                    stream.write(data)
                    remaining -= len(data)
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)
        return {'ok': True, 'path': relative, 'size': length}


def delete(relative):
    with LOCK:
        target = resolve(relative)
        if not target.exists():
            raise FileNotFoundError('File or folder was not found.')
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        return {'ok': True, 'path': relative}


def extract(relative):
    """Extract a ZIP into a new adjacent folder without path escape or ZIP bombs."""
    with LOCK:
        archive = resolve(relative)
        if not archive.is_file() or archive.suffix.lower() != '.zip':
            raise WorkspaceError('Select a ZIP archive from the uploaded workspace.')
        destination = archive.parent / archive.stem
        if destination.exists():
            raise FileExistsError('Extraction folder already exists: ' + destination.name)
        _, used, count = _scan()
        with zipfile.ZipFile(archive) as z:
            prepared = []
            seen = set()
            size = 0
            for entry in z.infolist():
                filename = entry.filename.rstrip('/')
                if not filename:
                    continue
                parts = _segments(filename)
                if (entry.flag_bits & 1 or stat.S_IFMT(entry.external_attr >> 16) == stat.S_IFLNK):
                    raise WorkspaceError('Encrypted archives and symbolic links are unsupported.')
                key = '/'.join(parts).casefold()
                if key in seen:
                    raise WorkspaceError('ZIP contains duplicate paths.')
                seen.add(key)
                if len(parts) + len(destination.relative_to(_root()).parts) > MAX_DEPTH:
                    raise WorkspaceError('ZIP directory structure is too deep.')
                if len(prepared) >= MAX_FILES:
                    raise WorkspaceError('ZIP contains too many entries.')
                if not entry.is_dir():
                    if entry.file_size > MAX_SINGLE_FILE:
                        raise WorkspaceError('An archived file exceeds the 512 MB limit.')
                    size += entry.file_size
                prepared.append((entry, parts))
            if used + size > MAX_WORKSPACE_BYTES or count + sum(not e.is_dir() for e, _ in prepared) > MAX_FILES:
                raise WorkspaceError('The ZIP would exceed workspace storage limits.')
            destination.mkdir()
            try:
                for entry, parts in prepared:
                    target = destination.joinpath(*parts)
                    if entry.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with z.open(entry) as input_stream, target.open('xb') as output_stream:
                            copied = 0
                            while data := input_stream.read(CHUNK):
                                copied += len(data)
                                if copied > entry.file_size or copied > MAX_SINGLE_FILE:
                                    raise WorkspaceError('ZIP file size does not match its header.')
                                output_stream.write(data)
                            if copied != entry.file_size:
                                raise WorkspaceError('ZIP entry is incomplete.')
            except Exception:
                shutil.rmtree(destination)
                raise
        return {'ok': True, 'path': destination.relative_to(_root()).as_posix(), 'files': sum(not e.is_dir() for e, _ in prepared)}
