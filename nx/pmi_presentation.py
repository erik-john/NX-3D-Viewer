"""Read exact visible annotation geometry from NX Open display instances."""

import math


def _read(obj, member):
    try:
        value = getattr(obj, member)
        return value() if callable(value) else value
    except Exception:
        return None


def _point(obj):
    if obj is None:
        return None
    try:
        values = [float(getattr(obj, axis)) for axis in ('X', 'Y', 'Z')]
    except Exception:
        try:
            values = [float(obj[i]) for i in range(3)]
        except Exception:
            return None
    return values if all(math.isfinite(v) and abs(v) < 1e9 for v in values) else None


def _objects(data, method, maximum):
    raw = _read(data, method)
    try:
        return list(raw or [])[:maximum]
    except Exception:
        return []


def _text(component):
    values = _read(component, 'GetText')
    if not values:
        return ''
    if isinstance(values, str):
        return values.strip()[:500]
    try:
        return ' '.join(str(v).strip() for v in values if v is not None).strip()[:500]
    except Exception:
        return ''


def extract_presentation(part, display_instances):
    """Extract NX model-space line, arrow, and text components, without editing the part.

    These are presentation coordinates, not geometry reconstructed from STL or
    inferred from a dimension's numeric value. Drawing-space components must
    not be treated as model-space PMI.
    """
    annotations = _read(part, 'Annotations')
    create = getattr(annotations, 'CreateComponentData', None)
    if not callable(create):
        return None
    for instance in display_instances:
        component_data = None
        try:
            # Display instances belong to the model PMI collection. A drawing
            # dimension uses different coordinates and must not be exported here.
            component_data = create(instance)
            if component_data is None:
                continue
            lines, arrows, texts = [], [], []
            for component in _objects(component_data, 'GetLineComponents', 300):
                a, b = _point(_read(component, 'StartPoint')), _point(_read(component, 'EndPoint'))
                if a and b and 1e-9 < math.dist(a, b) < 1e8:
                    lines.append({'start': a, 'end': b, 'type': str(_read(component, 'Type') or '')[:100]})
            for component in _objects(component_data, 'GetArrowComponents', 100):
                location = _point(_read(component, 'Origin'))
                if location:
                    arrows.append({'point': location, 'type': str(_read(component, 'Type') or '')[:80]})
            for component in _objects(component_data, 'GetTextComponents', 50):
                location = _point(_read(component, 'AdjustedOrigin')) or _point(_read(component, 'Origin'))
                content = _text(component)
                if location and content:
                    texts.append({'position': location, 'text': content})
            if lines or arrows or texts:
                return {'source': 'NX annotation display components', 'lines': lines,
                        'arrows': arrows, 'texts': texts}
        except Exception:
            continue
        finally:
            if component_data is not None:
                # Depending on NX release, transient resources may expose a
                # Dispose or FreeResource method. Neither modifies the part.
                for method in ('Dispose', 'FreeResource'):
                    dispose = getattr(component_data, method, None)
                    if callable(dispose):
                        try:
                            dispose()
                        except Exception:
                            pass
                        break
    return None
