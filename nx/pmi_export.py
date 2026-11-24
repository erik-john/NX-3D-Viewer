"""Read PMI and Inspector metadata without changing an NX part."""

import math
import re

from pmi_presentation import extract_presentation


def safe_value(obj, name, default=None):
    try:
        value = getattr(obj, name)
        return value() if callable(value) else value
    except Exception:
        return default


def point(value):
    if value is None:
        return None
    try:
        result = [float(getattr(value, key)) for key in ('X', 'Y', 'Z')]
    except Exception:
        try:
            result = [float(value[i]) for i in range(3)]
        except Exception:
            return None
    return result if all(math.isfinite(v) and abs(v) < 1e9 for v in result) else None


def text_of(value, limit=1000):
    if value is None:
        return ''
    if isinstance(value, (list, tuple)):
        return ' '.join(filter(None, (text_of(v, limit) for v in value)))[:limit]
    try:
        return str(value).strip()[:limit]
    except Exception:
        return ''


def attrs_of(obj):
    result = []
    try:
        attrs = obj.GetUserAttributes()
    except Exception:
        attrs = []
    for attr in list(attrs or [])[:200]:
        try:
            key = text_of(attr.Title, 200)
            kind = text_of(attr.Type).lower()
            property_name = ('StringValue' if 'string' in kind else
                             'IntegerValue' if 'integer' in kind else
                             'RealValue' if 'real' in kind or 'number' in kind else
                             'BooleanValue' if 'boolean' in kind else None)
            if key and property_name:
                result.append({'name': key, 'value': text_of(getattr(attr, property_name))})
        except Exception:
            pass
    return result


def get_text(obj):
    for name in ('GetDimensionText', 'GetText'):
        try:
            value = getattr(obj, name)()
            if value is not None:
                # NX dimension text is usually (main lines, dual lines).
                text = text_of(value)
                if text:
                    return text
        except Exception:
            pass
    for name in ('Text', 'MainText', 'Name'):
        value = safe_value(obj, name)
        if value:
            return text_of(value)
    return ''


def get_origin(obj, uf_session=None):
    for name in ('AnnotationOrigin', 'Origin', 'GetAnnotationOrigin', 'GetAssociativeOrigin'):
        origin = safe_value(obj, name)
        located = point(origin)
        if located is not None:
            return located
        for field in ('Origin', 'Point', 'Location'):
            located = point(safe_value(origin, field))
            if located is not None:
                return located
        if isinstance(origin, (list, tuple)):
            for candidate in origin:
                located = point(candidate)
                if located is not None:
                    return located
    return None



def tag_of(obj):
    try:
        return int(safe_value(obj, 'Tag'))
    except (TypeError, ValueError):
        return None


def associativity_points(assoc):
    """Return the actual NX definition points attached to an associativity."""
    if assoc is None:
        return []
    if isinstance(assoc, (list, tuple)):
        result = []
        for value in assoc:
            result.extend(associativity_points(value))
        return result
    result = []
    for field in ('FirstDefinitionPoint', 'SecondDefinitionPoint', 'Point', 'Coordinates'):
        value = point(safe_value(assoc, field))
        if value is not None and value not in result:
            result.append(value)
    return result


def dimension_associativities(item):
    """Collect references from both the dimension display and PMI semantic data."""
    refs = []
    for field in ('GetFirstAssociativity', 'GetSecondAssociativity'):
        value = safe_value(item, field)
        if value is not None:
            refs.append(value)
    lookup = getattr(item, 'GetAssociativity', None)
    if callable(lookup):
        try:
            count = int(safe_value(item, 'NumberOfAssociativities') or 2)
        except (ValueError, TypeError):
            count = 2
        # NX APIs differ in whether the first associativity index is 0 or 1.
        for i in range(min(10, max(2, count) + 2)):
            try:
                value = lookup(i)
                if value is not None:
                    refs.append(value)
            except Exception:
                continue
    return refs


def dimension_geometry(obj, display_instances, uf_session=None):
    """Read exact NX annotation references; do not infer guides from STL size."""
    candidates = [*display_instances, obj]
    semantic_data = safe_value(obj, 'GetDimensionData')
    if semantic_data is not None:
        candidates.append(semantic_data)
    anchors = [get_origin(candidate, uf_session) for candidate in [*display_instances, obj]]
    anchor = next((candidate for candidate in anchors if candidate is not None), None)
    for item in candidates:
        refs = dimension_associativities(item)
        if not refs:
            continue
        # Keep the ordered first-definition points for different associations.
        primary = []
        for ref in refs:
            for value in (ref if isinstance(ref, (list, tuple)) else [ref]):
                candidate = point(safe_value(value, 'FirstDefinitionPoint'))
                if candidate is not None and candidate not in primary:
                    primary.append(candidate)
        # Some NX annotations hold both definition points in a single reference.
        all_points = primary[:]
        for ref in refs:
            for candidate in associativity_points(ref):
                if candidate not in all_points:
                    all_points.append(candidate)
        for points in (primary, all_points):
            if len(points) < 2:
                continue
            first, second = points[:2]
            span = math.dist(first, second)
            if 1e-7 < span < 1e8:
                return {'start': first, 'end': second, 'origin': anchor,
                        'source': 'NX annotation associativity' if anchor is not None else 'NX definition points (placement unavailable)'}
    return None


def named_field(value):
    if isinstance(value, bool):
        return 'Yes' if value else 'No'
    return text_of(value)



def source_field(objects, keys):
    """Read a saved NX property without creating a builder or altering the part."""
    for obj in objects:
        if obj is None:
            continue
        for key in keys:
            value = safe_value(obj, key)
            if value is not None and not callable(value):
                return value
    return None


def nx_name(obj):
    for key in ('DisplayName', 'Name', 'JournalIdentifier'):
        value = text_of(safe_value(obj, key), 200)
        if value:
            return value
    return ''


def nx_object_type(obj):
    name = type(obj).__name__
    if name and name not in ('object', 'SimpleNamespace'):
        return name
    for key in ('Type', 'ObjectType'):
        value = text_of(safe_value(obj, key), 80)
        if value:
            return value
    return 'NX object'


def associated_objects(item, instances):
    """Return actual PMI dependencies; retain duplicate objects for NX traceability."""
    output = []
    seen = set()
    for source in [item] + list(instances):
        for accessor in ('GetAssociatedObject', 'GetSharedAssociatedObject'):
            association = safe_value(source, accessor)
            if association is None:
                continue
            targets = safe_value(association, 'GetObjects')
            if targets is None:
                targets = [association] if tag_of(association) is not None else []
            try:
                targets = list(targets)
            except Exception:
                continue
            for obj in targets[:200]:
                tag = tag_of(obj)
                name = nx_name(obj)
                obj_type = nx_object_type(obj)
                key = tag if tag is not None else (obj_type, name)
                if key in seen:
                    continue
                seen.add(key)
                output.append({'tag': tag, 'name': name or obj_type,
                               'type': obj_type})
    return output


def associated_views(part, instances):
    """Preserve actual PMI display-instance model-view membership."""
    output = []
    seen = set()
    work = source_field([safe_value(part, 'ModelingViews'), safe_value(part, 'Views')], ('WorkView',))
    displayed = source_field([safe_value(part, 'ModelingViews'), safe_value(part, 'Views')], ('DisplayedView',))
    for instance in instances:
        views = safe_value(instance, 'GetViews')
        if views is None:
            continue
        try:
            views = list(views)
        except Exception:
            continue
        for view in views[:200]:
            tag = tag_of(view)
            name = nx_name(view)
            key = tag if tag is not None else name
            if not key or key in seen:
                continue
            seen.add(key)
            output.append({'tag': tag, 'name': name or 'Model View',
                           'work': (tag_of(work) == tag if tag is not None and tag_of(work) is not None else None),
                           'displayed': (tag_of(displayed) == tag if tag is not None and tag_of(displayed) is not None else None)})
    return output


def dimension_details(item, instances):
    """Extract NX dimension properties, with unreported values left blank."""
    candidates = [item] + list(instances)
    data = safe_value(item, 'GetDimensionData')
    if data is not None:
        candidates.append(data)
    details = {}
    size = source_field(candidates, ('ComputedSize', 'GetComputedSize', 'Size'))
    try:
        if size is not None and math.isfinite(float(size)):
            details['Size'] = float(size)
    except (ValueError, TypeError, OverflowError):
        pass
    tolerance = source_field(candidates, ('ToleranceType', 'GetToleranceType'))
    if tolerance is not None:
        raw = text_of(tolerance)
        value = raw.split('.')[-1]
        if re.search(r'(^|type)(none|notolerance)$', value.replace('_','').lower()):
            value = 'No Tolerance'
        elif value.lower() in ('none', 'notolerance', 'no tolerance'):
            value = 'No Tolerance'
        details['Tolerance Type'] = value
    for label, fields in (
        ('Upper Tolerance', ('UpperToleranceValue', 'UpperMetricToleranceValue')),
        ('Lower Tolerance', ('LowerToleranceValue', 'LowerMetricToleranceValue')),
        ('Unit', ('DimensionUnit', 'Unit', 'Units')),
        ('Precision', ('DecimalPlaces', 'PrimaryDecimalPlaces')),
        ('URL', ('URL', 'Url', 'GetURL', 'GetUrl')),
    ):
        value = source_field(candidates, fields)
        if value is not None:
            details[label] = named_field(value)
    return details


def pmi_records(part, uf_session=None):
    records, warnings = [], []
    manager = safe_value(part, 'PmiManager')
    if manager is None:
        return records, ['NX did not expose a PMI manager for this part.']
    items = safe_value(manager, 'Pmis')
    if items is None:
        return records, ['NX PMI collection is unavailable in this session.']
    try:
        values = list(items)
    except Exception as exc:
        return records, ['NX PMI collection could not be enumerated: ' + str(exc)[:160]]
    for index, item in enumerate(values[:500]):
        try:
            instances = safe_value(item, 'GetDisplayInstances') or []
            instances = list(instances)
        except Exception:
            instances = []
        label = text_of(safe_value(item, 'Name')) or 'PMI ' + str(index + 1)
        kind = type(item).__name__
        if kind.lower() in ('pmi', 'ipmisemantics') and instances:
            kind = type(instances[0]).__name__
        text = get_text(item)
        anchor = get_origin(item, uf_session)
        for instance in instances:
            if not text or text == label:
                text = get_text(instance) or text
            if anchor is None:
                anchor = get_origin(instance, uf_session)
        item_attrs = attrs_of(item)
        for instance in instances:
            item_attrs.extend(entry for entry in attrs_of(instance) if entry not in item_attrs)
        details = {'Name': label, 'Type': kind, 'Text': text}
        saved_dimensions = dimension_details(item, instances)
        details = {**saved_dimensions, **details}
        try:
            data = item.GetDimensionData()
            if data:
                for name in ('Type', 'NumberOfParameterDimensions'):
                    value = safe_value(data, name)
                    if value is not None:
                        details[name] = text_of(value)
        except Exception:
            pass
        for entry in item_attrs:
            details[entry['name']] = entry['value']
        linked_objects = associated_objects(item, instances)
        linked_views = associated_views(part, instances)
        links = [entry['tag'] for entry in linked_objects if entry['tag'] is not None]
        presentation = extract_presentation(part, instances)
        shape = dimension_geometry(item, instances, uf_session)
        position_source = 'NX annotation origin' if anchor is not None else None
        if presentation and presentation['texts']:
            anchor = presentation['texts'][0]['position']
            position_source = 'NX annotation text component'
        if anchor is None and shape is not None:
            # Position the label between NX definition points when NX provides
            # reference coordinates but no annotation text location.
            anchor = [(a + b) / 2 for a, b in zip(shape['start'], shape['end'])]
            position_source = 'NX definition-point midpoint (display fallback)'
        if shape is None and not (presentation and presentation['lines']) and ('dimension' in kind.lower() or 'dimension' in label.lower()):
            warnings.append('PMI "{}" has no readable NX dimension definition points; graphical reference lines are unavailable.'.format(label[:100]))
        source_tags = [tag for tag in [tag_of(item), *(tag_of(x) for x in instances)] if tag is not None]
        records.append({'id': 'pmi_' + str(index + 1), 'name': label, 'type': kind,
                        'text': text, 'position': anchor, 'positionSource': position_source, 'details': details,
                        'dimension': shape, 'presentation': presentation, 'sourceTags': source_tags,
                        'associatedTags': links[:100],
                        'dependencies': {'associatedObjects': linked_objects,
                                         'modelViews': linked_views},
                        'attributes': item_attrs})
    if len(values) > 500:
        warnings.append('PMI list exceeded the 500-item display limit.')
    return records, warnings


def characteristic_record(item, index):
    """Return saved Inspector parameters, including fields outside the PMI text."""
    fields = ('BaseId', 'BaseID', 'BaseIdString', 'Basic', 'Designator',
              'ExtensionId', 'ExtensionID', 'Index', 'Inspection',
              'NominalPrecision', 'NominalValue', 'Reference', 'Status', 'Type',
              'Unit', 'Units', 'UUID', 'Uuid', 'Guid', 'Title', 'Name',
              'UpperTolerance', 'LowerTolerance', 'Tolerance', 'UpperAllowance',
              'LowerAllowance', 'UpperDelta', 'LowerDelta', 'Criticality',
              'Identifier', 'Description', 'Note', 'AppendedTextTop',
              'AppendedTextBottom', 'AppendedTextLeft', 'AppendedTextRight')
    details = {}
    for field in fields:
        value = safe_value(item, field)
        if value is None or callable(value):
            continue
        if isinstance(value, (str, int, float, bool)):
            details[field] = named_field(value)
        elif field.lower() in ('status', 'unit', 'units', 'uuid', 'guid', 'type'):
            details[field] = text_of(value)
        elif isinstance(value, (list, tuple)) and all(isinstance(v, (str, int, float, bool)) for v in value[:50]):
            details[field] = text_of(value)
    for attr in attrs_of(item):
        details[attr['name']] = attr['value']
    name = details.get('Designator') or details.get('Title') or details.get('Name') or ''
    if not name and not any(key.lower() in ('baseid', 'base id', 'nominalvalue') for key in details):
        return None
    return {'id': 'chr_' + str(index + 1), 'name': name or 'Characteristic ' + str(index + 1),
            'type': 'characteristic', 'details': details, 'pmiId': None,
            'position': get_origin(item)}


def linked_pmi_record(item, pmis):
    by_tag = {tag: pmi for pmi in pmis for tag in pmi.get('sourceTags', [])}
    sources = ('GetAssociatedPmi', 'GetAssociatedPMI', 'GetAssociatedObject',
               'AssociatedPmi', 'AssociatedPMI', 'Pmi', 'PMI',
               'SourcePmi', 'ReferencedPmi', 'GetPmi')
    for field in sources:
        value = safe_value(item, field)
        if value is None:
            continue
        possible = [value]
        try:
            possible.extend(value.GetObjects() or [])
        except Exception:
            pass
        for candidate in possible:
            tag = tag_of(candidate)
            if tag in by_tag:
                return by_tag[tag]
    return None

def characteristic_records(part, pmis):
    records, warnings = [], []
    # NX Inspector's object model varies by installed release/license. Check
    # read-only collection accessors but never invoke creators/builders.
    owners = [part]
    manager = safe_value(part, 'PmiManager')
    if manager is not None:
        owners.append(manager)
        try:
            owners.extend(list(safe_value(manager, 'Pmis') or [])[:500])
        except Exception:
            pass
    for owner_name in ('Inspector', 'InspectorManager', 'CharacteristicManager', 'CharacteristicsManager', 'InspectionManager'):
        owner = safe_value(part, owner_name)
        if owner is not None:
            owners.append(owner)
    accessors = ('Characteristics', 'CharacteristicInstances', 'CharacteristicsCollection',
                 'GetCharacteristics', 'GetCharacteristicInstances', 'GetAllCharacteristics')
    found_collection = False
    for owner in owners:
        for name in accessors:
            objects = safe_value(owner, name)
            if objects is None or isinstance(objects, (str, bytes, dict)):
                continue
            try:
                values = list(objects)
            except Exception:
                continue
            found_collection = True
            for item in values[:500]:
                record = characteristic_record(item, len(records))
                if record and not any(previous['name'] == record['name'] for previous in records):
                    match = linked_pmi_record(item, pmis)
                    if match:
                        record['pmiId'] = match['id']
                        if record['position'] is None:
                            record['position'] = match['position']
                    records.append(record)
            if records:
                break
        if records:
            break
    # A characteristic may have its fields stored as ordinary NX attributes on
    # a PMI object. Accept only an explicit designator plus characteristic data.
    if not records:
        for pmi in pmis:
            fields = pmi.get('details', {})
            norm = {re.sub('[^a-z0-9]', '', key.lower()): value for key, value in fields.items()}
            designator = norm.get('designator') or norm.get('characteristicdesignator')
            base_id = norm.get('baseid')
            if not designator or not (base_id or re.fullmatch(r'PC\d+(?:\.\d+)?', designator, re.I)):
                continue
            records.append({'id': 'chr_' + str(len(records) + 1),
                            'name': designator, 'type': 'characteristic',
                            'details': dict(fields), 'pmiId': pmi['id'],
                            'position': pmi.get('position')})
    if not records:
        warnings.append('NX Inspector characteristic records were not accessible through the available NX Open collections; this does not mean the part has no Characteristics.')
    return records, warnings


def extract_annotations(part, uf_session=None):
    pmis, pmi_warnings = pmi_records(part, uf_session)
    characteristic, characteristic_warnings = characteristic_records(part, pmis)
    return {'pmi': pmis, 'characteristics': characteristic,
            'warnings': characteristic_warnings + pmi_warnings}
