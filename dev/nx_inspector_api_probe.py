"""Read-only NX Open API inspection for unavailable Characteristic records.

Run with the same Siemens NX installation used by the viewer:
run_journal.exe dev/nx_inspector_api_probe.py -args full_part_path.prt output.json
No part is saved or changed.
"""
import io
import json
import os
import sys
import traceback


def names(obj):
    try:
        return sorted(x for x in dir(obj) if not x.startswith('_') and
                      ('inspector' in x.lower() or 'characterist' in x.lower() or
                       'pmi' in x.lower()))[:150]
    except Exception:
        return []


def run(path, destination):
    import NXOpen
    session = NXOpen.Session.GetSession()
    opened = session.Parts.OpenBaseDisplay(path)
    part = next((obj for obj in opened if hasattr(obj, 'Bodies')), None) if isinstance(opened, tuple) else opened
    if part is None:
        raise RuntimeError('NX did not return the part.')
    try:
        import NXOpen.UF
        uf_session = NXOpen.UF.UFSession.GetUFSession()
    except Exception:
        uf_session = None
    result = {'partMembers': names(part), 'sessionMembers': names(session),
              'pmiManagerMembers': names(getattr(part, 'PmiManager', None)),
              'inspectorNamespaceMembers': [], 'pmiCount': None}
    try:
        import NXOpen.Inspector
        result['inspectorNamespaceMembers'] = names(NXOpen.Inspector)
    except Exception as exc:
        result['inspectorModuleError'] = str(exc)[:200]
    try:
        result['pmiCount'] = len(list(part.PmiManager.Pmis))
    except Exception as exc:
        result['pmiError'] = str(exc)[:200]
    for manager_name in result['partMembers']:
        if 'inspector' not in manager_name.lower() and 'characterist' not in manager_name.lower():
            continue
        try:
            owner = getattr(part, manager_name)
            if callable(owner):
                continue
            result['manager_' + manager_name] = names(owner)
        except Exception:
            pass
    # Report safe geometric accessors of a few PMI display instances; different
    # NX builds may expose the same reference through distinct associations.
    def read_point(value):
        try:
            return [float(value.X), float(value.Y), float(value.Z)]
        except Exception:
            return None

    def association_data(obj):
        if obj is None:
            return None
        entry = {'type': type(obj).__name__}
        for name in ('FirstDefinitionPoint', 'SecondDefinitionPoint'):
            try:
                entry[name] = read_point(getattr(obj, name))
            except Exception as exc:
                entry[name + 'Error'] = str(exc)[:120]
        return entry

    samples = []
    try:
        for pmi in list(part.PmiManager.Pmis)[:5]:
            sample = {'name': str(getattr(pmi, 'Name', 'PMI')),
                      'class': type(pmi).__name__, 'instances': []}
            try:
                instances = list(pmi.GetDisplayInstances())
            except Exception as exc:
                instances = []
                sample['instanceError'] = str(exc)[:160]
            for instance in instances[:3]:
                detail = {'class': type(instance).__name__, 'members': names(instance)}
                for property_name in ('AnnotationOrigin', 'NumberOfAssociativities'):
                    try:
                        value = getattr(instance, property_name)
                        detail[property_name] = read_point(value) if property_name == 'AnnotationOrigin' else str(value)
                    except Exception as exc:
                        detail[property_name + 'Error'] = str(exc)[:120]
                for method in ('GetFirstAssociativity', 'GetSecondAssociativity'):
                    try:
                        detail[method] = association_data(getattr(instance, method)())
                    except Exception as exc:
                        detail[method + 'Error'] = str(exc)[:120]
                for idx in (0, 1, 2):
                    try:
                        detail['GetAssociativity({})'.format(idx)] = association_data(instance.GetAssociativity(idx))
                    except Exception as exc:
                        detail['GetAssociativity({})Error'.format(idx)] = str(exc)[:120]
                if uf_session is not None:
                    try:
                        detail['UFDrfOrigin'] = read_point(uf_session.Drf.AskOrigin(instance.Tag))
                    except Exception as exc:
                        detail['UFDrfOriginError'] = str(exc)[:120]
                try:
                    component_data = part.Annotations.CreateComponentData(instance)
                    try:
                        line_parts = list(component_data.GetLineComponents())
                        arrow_parts = list(component_data.GetArrowComponents())
                        text_parts = list(component_data.GetTextComponents())
                        detail['annotationComponents'] = {
                            'lineCount': len(line_parts), 'arrowCount': len(arrow_parts),
                            'textCount': len(text_parts),
                            'lineSamples': [
                                {'start': read_point(segment.StartPoint),
                                 'end': read_point(segment.EndPoint)}
                                for segment in line_parts[:12]],
                            'arrowSamples': [read_point(arrow.Origin) for arrow in arrow_parts[:8]],
                            'textSamples': [
                                {'origin': read_point(partText.Origin),
                                 'text': list(partText.GetText())[:3]}
                                for partText in text_parts[:5]],
                        }
                    finally:
                        dispose = getattr(component_data, 'Dispose', None)
                        if callable(dispose):
                            dispose()
                except Exception as exc:
                    detail['annotationComponentError'] = str(exc)[:250]
                sample['instances'].append(detail)
            samples.append(sample)
    except Exception as exc:
        result['pmiReferenceError'] = str(exc)[:160]
    result['pmiReferenceSamples'] = samples
    # Use the same read-only extractors as the viewer, so the result identifies
    # which exact parameters and NX dimension reference points are accessible.
    try:
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'nx')))
        from pmi_export import extract_annotations
        result['annotationProbe'] = extract_annotations(part, uf_session)
    except Exception as exc:
        result['annotationProbeError'] = str(exc)[:300]
    with io.open(destination, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('-args') + 1:] if '-args' in sys.argv else sys.argv[1:]
    if len(args) != 2:
        raise RuntimeError('Supply part filepath and JSON output path.')
    run(os.path.abspath(args[0]), os.path.abspath(args[1]))
