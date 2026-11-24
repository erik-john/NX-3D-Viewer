"""Read an optional NX Inspector Characteristics part alongside a model."""

import os
import re
from pathlib import Path

from pmi_export import characteristic_records


def find_characteristics_part(source):
    """Choose a same-product CHR file, never an unrelated nearby binary."""
    source = Path(source)
    if source.suffix.lower() != '.prt' or not source.is_file():
        return None
    expected = (source.stem + '_chr.chr', source.stem + '.chr')
    try:
        neighbors = {candidate.name.casefold(): candidate for candidate in source.parent.iterdir()
                     if candidate.is_file() and candidate.suffix.lower() == '.chr'}
    except OSError:
        return None
    for name in expected:
        candidate = neighbors.get(name.casefold())
        if candidate is None:
            continue
        if candidate.stat().st_size > 512 * 1024 * 1024:
            raise ValueError('The associated NX Characteristics file exceeds 512 MB.')
        with candidate.open('rb') as stream:
            header = stream.read(4096)
        if not header.startswith(b'SPLMSSTR') or b'CHRPARTS' not in header:
            raise ValueError('The associated .chr file is not recognized as an NX Characteristics part.')
        return candidate
    return None



# A bounded diagnostic fingerprint, not a decoder of Inspector semantics.
# It must never be used to invent parameter values or PMI associations.
_IDENTIFIER_PATTERN = re.compile(
    rb'(?<![A-Za-z0-9])(?P<designator>PC[1-9][0-9]{0,7}(?:\.[0-9]{1,6})?)\x00'
    rb'.{0,16}?(?P<uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\x00',
    re.IGNORECASE | re.DOTALL)


def observed_designators(source):
    """Show possible designators from a native CHR without interpreting values.

    These are only diagnostic candidates until NX returns actual characteristic
    instances. The strict designator+UUID pattern prevents collecting ordinary
    PMI strings, while unknown CHR encodings simply return no candidates.
    """
    try:
        with Path(source).open('rb') as stream:
            raw = stream.read(32 * 1024 * 1024)
    except OSError:
        return []
    if not raw.startswith(b'SPLMSSTR') or b'CHRPARTS' not in raw[:4096]:
        return []
    entries, seen = [], set()
    for match in _IDENTIFIER_PATTERN.finditer(raw):
        identifier = match.group('designator').decode('ascii').upper()
        uuid = match.group('uuid').decode('ascii').lower()
        if identifier in seen:
            continue
        seen.add(identifier)
        entries.append({'designator': identifier, 'uuid': uuid})
        if len(entries) >= 256:
            break
    return entries


def _opened_part(opened):
    if isinstance(opened, tuple):
        part = next((value for value in opened if hasattr(value, 'PartUnits') or hasattr(value, 'Bodies')
                     or hasattr(value, 'FullPath') or hasattr(value, 'Leaf')), None)
        status = next((value for value in opened if hasattr(value, 'Dispose') and value is not part), None)
        return part, status
    return opened, None


def load_characteristics_part(session, part_path, annotations):
    """Extract Inspector records without modifying or saving native NX data.

    Called after the PRT's STL and PMI data have already been produced. NX Open
    release/license differences are reported rather than guessed over.
    """
    if not isinstance(annotations, dict):
        return annotations
    try:
        source = find_characteristics_part(part_path)
    except (OSError, ValueError) as error:
        annotations.setdefault('warnings', []).append(str(error))
        return annotations
    if source is None:
        return annotations

    annotations['characteristicsFile'] = {
        'name': source.name, 'status': 'unavailable',
        'observedDesignators': observed_designators(source),
    }
    status = None
    try:
        opened = session.Parts.OpenBaseDisplay(str(source))
        part, status = _opened_part(opened)
        if part is None:
            raise RuntimeError('NX did not return the Characteristics part.')
        entries, warnings = characteristic_records(part, annotations.get('pmi', []))
        if entries:
            current = list(annotations.get('characteristics') or [])
            existing = {str(item.get('details', {}).get('UUID') or item.get('name') or '').casefold()
                        for item in current}
            for entry in entries:
                token = str(entry.get('details', {}).get('UUID') or entry.get('name') or '').casefold()
                if not token or token in existing:
                    continue
                entry['sourceFile'] = source.name
                entry['id'] = 'chr_' + str(len(current) + 1)
                current.append(entry)
                existing.add(token)
            annotations['characteristics'] = current
            annotations['characteristicsFile']['status'] = 'loaded'
            annotations['warnings'] = [msg for msg in (annotations.get('warnings') or [])
                                       if 'NX Inspector characteristic records were not accessible' not in msg]
            # Preserve any other actual NX warnings.
            annotations['warnings'].extend(w for w in warnings
                                           if 'not accessible' not in w.lower())
        else:
            annotations.setdefault('warnings', []).append(
                'The associated .chr file was found, but NX did not expose its '
                'Inspector records through the available read-only accessors. '
                'Run dev/nx_inspector_api_probe.py with the .chr path.')
    except Exception as error:
        annotations.setdefault('warnings', []).append(
            'NX could not read the associated Characteristics part "{}": {}. '
            'The PRT geometry and PMI remain available.'.format(source.name, str(error)[:250]))
    finally:
        if status is not None:
            try:
                status.Dispose()
            except Exception:
                pass
    return annotations
