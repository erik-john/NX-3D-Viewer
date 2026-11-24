"""Read NX Inspector characteristics from the linked Characteristics part."""

import math

from pmi_export import (attrs_of, characteristic_record, linked_pmi_record,
                        nx_name, safe_value, tag_of, text_of)


def _objects(value):
    if value is None or isinstance(value, (str, bytes, dict)):
        return []
    try:
        return list(value)[:500]
    except (TypeError, ValueError):
        return []


def _uuid(obj):
    return text_of(safe_value(obj, 'UniversallyUniqueIdentifier'), 100)


def _value_data(obj):
    if obj is None:
        return None, None
    raw = safe_value(obj, 'Value')
    precision = safe_value(obj, 'Precision')
    return raw, precision


def _field(detail, key, value):
    if value is None or callable(value):
        return
    if isinstance(value, (bool, float, int, str)):
        detail[key] = ('Yes' if value is True else 'No' if value is False else str(value))


def _semantics(instance, details):
    """Read saved Inspector dimension values; never use a PMI text as a substitute."""
    dimension = safe_value(instance, 'GetDimensionSemantics')
    if dimension is None:
        return
    nominal, precision = _value_data(safe_value(dimension, 'Nominal'))
    _field(details, 'Nominal Value', nominal)
    _field(details, 'Nominal Precision', precision)
    for key, member in (('Upper Tolerance', 'UpperTolerance'),
                        ('Lower Tolerance', 'LowerTolerance')):
        value = safe_value(dimension, member)
        raw, _ = _value_data(value)
        _field(details, key, raw if raw is not None else value)


def _match_pmi(characteristic, instance, pmis, details, features):
    """Prefer explicit NX associations; use a unique saved nominal only as fallback."""
    for obj in (instance, characteristic):
        linked = linked_pmi_record(obj, pmis)
        if linked is not None:
            return linked, 'NX PMI reference'
        ref = safe_value(obj, 'ReferenceObject')
        tag = tag_of(ref)
        if tag is not None:
            matches = [p for p in pmis if tag in p.get('sourceTags', [])]
            if len(matches) == 1:
                return matches[0], 'NX Inspector ReferenceObject'

    # An instance may refer to original CAD faces rather than the PMI object.
    # Associate only when those face tags identify a single PMI.
    face_tags = {tag_of(obj) for obj in features} - {None}
    if face_tags:
        matches = [p for p in pmis if face_tags.intersection(p.get('associatedTags') or [])]
        if len(matches) == 1:
            return matches[0], 'NX associated geometry'

    # NX Inspector may provide an exact saved nominal but no usable PMI pointer.
    # A value match is an inference, and only safe if unique within this part.
    try:
        nominal = float(details.get('Nominal Value'))
    except (TypeError, ValueError):
        return None, None
    if not math.isfinite(nominal):
        return None, None
    matches = []
    for pmi in pmis:
        try:
            size = float((pmi.get('details') or {}).get('Size'))
        except (TypeError, ValueError):
            continue
        if math.isfinite(size) and math.isclose(nominal, size, rel_tol=1e-8, abs_tol=1e-5):
            matches.append(pmi)
    if len(matches) == 1:
        return matches[0], 'unique NX nominal dimension match (inferred)'
    return None, None


def _record_for_instance(characteristic, instance, index, pmis):
    # NX stores the definition and the individual characteristic instance
    # separately; values/semantics belong to the instance.
    record = characteristic_record(instance, index)
    definition = characteristic_record(characteristic, index)
    details = dict(definition['details']) if definition else {}
    if record:
        details.update(record['details'])
    for obj in (characteristic, instance):
        for attr in attrs_of(obj):
            details.setdefault(attr['name'], attr['value'])
    _semantics(instance, details)
    _field(details, 'UUID', _uuid(instance) or _uuid(characteristic) or None)
    identifier = (text_of(safe_value(instance, 'DisplayIdentifier'), 200)
                  or text_of(safe_value(characteristic, 'DisplayIdentifier'), 200)
                  or details.get('Designator') or details.get('Name')
                  or nx_name(instance) or nx_name(characteristic))
    if not identifier and not details:
        return None
    identifier = identifier or 'Characteristic {}'.format(index + 1)
    details.setdefault('Designator', identifier)
    features = _objects(safe_value(instance, 'GetFeature'))
    entry = {'id': 'chr_' + str(index + 1), 'name': identifier,
             'type': 'characteristic', 'details': details, 'pmiId': None,
             'position': None}
    linked, source = _match_pmi(characteristic, instance, pmis, details, features)
    if linked is not None:
        entry['pmiId'] = linked['id']
        entry['position'] = linked.get('position')
        entry['associationSource'] = source
    if features:
        entry['features'] = [{'tag': tag_of(obj), 'name': nx_name(obj),
                              'type': type(obj).__name__} for obj in features]
    return entry

def _collect(char_part, pmis):
    definitions = _objects(safe_value(char_part, 'GetCharacteristics'))
    output = []
    seen = set()
    for definition in definitions:
        instances = _objects(safe_value(definition, 'GetInstances')) or [definition]
        for instance in instances:
            record = _record_for_instance(definition, instance, len(output), pmis)
            if not record:
                continue
            uuid = record['details'].get('UUID')
            key = uuid or (record['name'], tag_of(instance))
            if key in seen:
                continue
            seen.add(key)
            output.append(record)
            if len(output) >= 500:
                return output
    return output


def read_inspector_records(session, design_part, opened_chr, pmis):
    """Query the NX 2506 Manager for the linked, read-only CharacteristicPart."""
    notes = []
    try:
        import NXOpen.Inspector as inspector
        manager = inspector.Manager.GetManager(session)
    except Exception as error:
        return [], ['NX Inspector Manager unavailable: {}: {}'.format(
            type(error).__name__, str(error)[:150])]
    candidates = []
    if hasattr(opened_chr, 'GetCharacteristics'):
        candidates.append(opened_chr)
    if design_part is not None:
        try:
            linked = manager.GetCharacteristicPart(design_part)
            if linked is not None:
                candidates.append(linked)
        except Exception as error:
            notes.append('GetCharacteristicPart: {}: {}'.format(type(error).__name__, str(error)[:150]))
    # If the active part is itself a native CharacteristicPart, use it.
    for key in ('Work', 'Display'):
        active = safe_value(session.Parts, key)
        if active is not None and hasattr(active, 'GetCharacteristics'):
            candidates.append(active)
    seen = set()
    for candidate in candidates:
        key = id(candidate)
        if key in seen:
            continue
        seen.add(key)
        try:
            result = _collect(candidate, pmis)
        except Exception as error:
            notes.append('GetCharacteristics: {}: {}'.format(type(error).__name__, str(error)[:150]))
            continue
        if result:
            return result, []
    # Some NX configurations expose only the Manager collection. Its Python
    # iteration support varies; no modifications or builders are attempted.
    collection = safe_value(manager, 'CharacteristicsCollection')
    for definition in _objects(collection):
        # The collection may expose the same Characteristic objects directly.
        class PartProxy:
            def GetCharacteristics(self):
                return [definition]
        results = _collect(PartProxy(), pmis)
        if results:
            return results, []
    notes.append('Inspector Manager exposed no readable Characteristic records.')
    return [], notes
