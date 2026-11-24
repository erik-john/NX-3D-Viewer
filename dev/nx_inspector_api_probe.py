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


def public_members(obj, limit=300):
    try:
        return sorted(x for x in dir(obj) if not x.startswith('_'))[:limit]
    except Exception:
        return []


def write_report(destination, report):
    with io.open(destination, 'w', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)


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
    result = {'sourceExtension': os.path.splitext(path)[1].lower(),
              'sourceName': os.path.basename(path),
              'sessionMembers': names(session),
              'inspectorNamespaceMembers': [], 'pmiCount': None}
    try:
        opened = session.Parts.OpenBaseDisplay(path)
        part = next((obj for obj in opened if hasattr(obj, 'Bodies') or
                     hasattr(obj, 'FullPath') or hasattr(obj, 'PartUnits') or
                     hasattr(obj, 'Leaf')), None) if isinstance(opened, tuple) else opened
        if part is None:
            raise RuntimeError('NX did not return a readable BasePart.')
    except Exception as exc:
        result['partOpenError'] = '{}: {}'.format(type(exc).__name__, str(exc))[:800]
        result['partsCollectionMembers'] = public_members(session.Parts)
        try:
            import NXOpen.Inspector
            result['inspectorNamespaceMembers'] = public_members(NXOpen.Inspector)
        except Exception as inner:
            result['inspectorModuleError'] = '{}: {}'.format(type(inner).__name__, str(inner))[:400]
        write_report(destination, result)
        return
    result.update({'partMembers': names(part), 'partObjectType': type(part).__name__,
                   'pmiManagerMembers': names(getattr(part, 'PmiManager', None)),
                   'partPublicMembers': public_members(part),
                   'partsCollectionMembers': public_members(session.Parts)})
    try:
        import NXOpen.UF
        uf_session = NXOpen.UF.UFSession.GetUFSession()
    except Exception:
        uf_session = None
    try:
        import NXOpen.Inspector
        result['inspectorNamespaceMembers'] = public_members(NXOpen.Inspector)
        result['inspectorTypes'] = {}
        for type_name in result['inspectorNamespaceMembers']:
            if not any(token in type_name.lower() for token in ('characteristic', 'inspector', 'root', 'facet', 'instance')):
                continue
            cls = getattr(NXOpen.Inspector, type_name, None)
            if cls is not None:
                result['inspectorTypes'][type_name] = public_members(cls, 120)
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
            result['manager_' + manager_name] = public_members(owner)
        except Exception:
            pass
    # The companion Characteristics part contains Inspector data even when the
    # linked PRT's ordinary PMI collection cannot reveal those records.
    for owner_name in ('Inspector', 'InspectorManager', 'InspectorRoot',
                       'CharacteristicManager', 'CharacteristicsManager',
                       'ProductCharacteristicManager', 'ProductCharacteristicsManager'):
        try:
            owner = getattr(part, owner_name)
            if callable(owner):
                continue
            result['inspectorOwner_' + owner_name] = {
                'type': type(owner).__name__,
                'members': public_members(owner),
            }
        except Exception:
            pass
    for scope in (part, getattr(part, 'InspectorManager', None)):
        if scope is None:
            continue
        for field in ('Characteristics', 'CharacteristicInstances', 'ProductCharacteristics',
                      'ProductCharacteristicInstances', 'GetCharacteristics',
                      'GetCharacteristicInstances', 'GetProductCharacteristics',
                      'GetProductCharacteristicInstances'):
            try:
                value = getattr(scope, field)
                values = list((value() if callable(value) else value) or [])[:20]
                result['collection_' + type(scope).__name__ + '_' + field] = {
                    'countCappedAt': len(values),
                    'examples': [
                        {'type': type(item).__name__, 'members': names(item),
                         'designator': str(getattr(item, 'Designator', ''))[:100],
                         'nominalValue': str(getattr(item, 'NominalValue', ''))[:100]}
                        for item in values[:5]
                    ],
                }
            except Exception as exc:
                result.setdefault('collectionErrors', {})[
                    type(scope).__name__ + '_' + field] = '{}: {}'.format(
                        type(exc).__name__, str(exc))[:250]
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
    write_report(destination, result)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('-args') + 1:] if '-args' in sys.argv else sys.argv[1:]
    if len(args) != 2:
        raise RuntimeError('Supply part filepath and JSON output path.')
    source_path, output_path = os.path.abspath(args[0]), os.path.abspath(args[1])
    try:
        run(source_path, output_path)
    except Exception as exc:
        # Preserve diagnostic evidence even when NX cannot initialize or open CHR.
        report = {
            'sourceName': os.path.basename(source_path),
            'sourceExtension': os.path.splitext(source_path)[1].lower(),
            'probeFatalError': '{}: {}'.format(type(exc).__name__, str(exc))[:1000],
            'probeTraceback': traceback.format_exc()[-6000:],
        }
        write_report(output_path, report)
        print('NX Inspector probe failed; diagnostic JSON saved: ' + output_path)
