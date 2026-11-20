"""Export an NX part and its component-occurrence hierarchy as STL geometry."""

import io
import json
import os
import sys
import traceback




def record_stage(stage_path, message):
    """Keep an export progress trail even if the NX process terminates unexpectedly."""
    if not stage_path:
        return
    with io.open(stage_path, 'a', encoding='utf-8') as stream:
        stream.write(message + '\n')

def journal_arguments():
    args = sys.argv
    return args[args.index('-args') + 1:] if '-args' in args else args[1:]


def name_of(item, fallback):
    for property_name in ('DisplayName', 'Name', 'JournalIdentifier'):
        try:
            value = getattr(item, property_name)
            if value:
                return str(value)
        except Exception:
            pass
    return fallback


def build_structure(part):
    """Return the actual occurrence tree and positioned bodies for export."""
    all_bodies = []
    exported_tags = set()
    leaf_bodies = []

    def add_body(body, node_id, label):
        try:
            tag = int(body.Tag)
        except Exception:
            tag = id(body)
        if tag not in exported_tags:
            exported_tags.add(tag)
            all_bodies.append(body)
        leaf_bodies.append((node_id, body))
        return {'id': node_id, 'name': label, 'type': 'body',
                'meshId': node_id, 'children': []}

    def own_bodies(source, occurrence, prefix):
        nodes = []
        for index, proto in enumerate(source.Bodies):
            body = proto
            if occurrence is not None:
                body = occurrence.FindOccurrence(proto)
                if body is None:
                    raise RuntimeError('Could not resolve an assembly body position. Load the component fully in NX.')
                if int(body.Tag) == int(proto.Tag):
                    raise RuntimeError('NX returned a prototype body instead of a positioned assembly body.')
            nodes.append(add_body(body, prefix + '_b' + str(index + 1),
                                  name_of(proto, 'Body ' + str(index + 1))))
        return nodes

    def prototype_key(prototype, fallback):
        # FullPath identifies the source NX .prt across repeated occurrences.
        # Do not infer part size/type from instance labels when NX can identify it.
        for property_name in ('FullPath', 'FullPathName', 'Name', 'Leaf', 'DisplayName'):
            try:
                value = getattr(prototype, property_name)
                if value:
                    return str(value)
            except Exception:
                pass
        return fallback

    def component_node(component, path):
        prototype = component.Prototype
        if prototype is None or not hasattr(prototype, 'Bodies'):
            raise RuntimeError('A component is not loaded. Load all assembly components in NX and try again.')
        result = {'id': path, 'name': name_of(component, 'Component'),
                  'type': 'component',
                  'partKey': prototype_key(prototype, name_of(component, path)),
                  'children': own_bodies(prototype, component, path)}
        for index, child in enumerate(component.GetChildren()):
            result['children'].append(component_node(child, path + '_c' + str(index + 1)))
        return result

    root = {'id': 'root', 'name': name_of(part, 'NX Part'), 'type': 'part',
            'children': own_bodies(part, None, 'root')}
    assembly = getattr(part, 'ComponentAssembly', None)
    root_component = getattr(assembly, 'RootComponent', None) if assembly else None
    if root_component is not None:
        for index, child in enumerate(root_component.GetChildren()):
            root['children'].append(component_node(child, 'root_c' + str(index + 1)))
    if not all_bodies:
        raise RuntimeError('No solid or sheet bodies were found in the selected NX part.')
    return root, all_bodies, leaf_bodies


def get_part_information(part):
    """Read optional NX properties without interfering with STL export."""
    information = {'units': None, 'attributes': []}
    try:
        units = str(part.PartUnits).lower()
        if 'millimeter' in units:
            information['units'] = 'mm'
        elif 'inch' in units:
            information['units'] = 'in'
    except Exception:
        pass
    try:
        attributes = part.GetUserAttributes()
    except Exception:
        attributes = []
    for attribute in list(attributes or [])[:50]:
        try:
            name = str(attribute.Title)
            kind = str(attribute.Type).lower()
            if 'string' in kind:
                value = attribute.StringValue
            elif 'integer' in kind:
                value = attribute.IntegerValue
            elif 'real' in kind or 'number' in kind:
                value = attribute.RealValue
            elif 'boolean' in kind:
                value = attribute.BooleanValue
            else:
                continue
            information['attributes'].append({'name': name, 'value': str(value)})
        except Exception:
            continue
    return information

def bodies_for_export(part):
    return build_structure(part)[1]


def export_bodies(session, bodies, output_path):
    import NXOpen
    creator = session.DexManager.CreateStlCreator()
    try:
        creator.OutputFile = output_path
        creator.ChordalTol = 0.05
        creator.AngularTol = 15.0
        creator.AutoNormalGen = True
        creator.OutputType = NXOpen.STLCreator.OutputTypeEnum.Binary
        for body in bodies:
            creator.ExportSelectionBlock.Add(body)
        creator.Commit()
    finally:
        creator.Destroy()
    if not os.path.isfile(output_path) or os.path.getsize(output_path) <= 84:
        raise RuntimeError('NX STL export did not generate any geometry.')


def export(input_path, output_path, manifest_path=None, stage_path=None):
    record_stage(stage_path, 'starting NX Open')
    import NXOpen
    record_stage(stage_path, 'initializing NX session')
    session = NXOpen.Session.GetSession()
    record_stage(stage_path, 'opening NX part')
    opened = session.Parts.OpenBaseDisplay(input_path)
    if isinstance(opened, tuple):
        part = next((item for item in opened if hasattr(item, 'Bodies')), None)
        load_status = next((item for item in opened if hasattr(item, 'Dispose') and not hasattr(item, 'Bodies')), None)
    else:
        part, load_status = opened, None
    try:
        if part is None:
            raise RuntimeError('NX could not open the selected part.')
        record_stage(stage_path, 'reading NX body and component structure')
        root, bodies, leaves = build_structure(part)
        # The combined STL is the complete fallback if an individual export fails.
        record_stage(stage_path, 'exporting combined STL geometry')
        export_bodies(session, bodies, output_path)
        if manifest_path is None:
            record_stage(stage_path, 'completed NX export')
            return
        record_stage(stage_path, 'exporting separate body STL geometry')
        meshes = []
        separate_error = None
        for index, (node_id, body) in enumerate(leaves, 1):
            filename = os.path.splitext(os.path.basename(output_path))[0] + '_body_{:05d}.stl'.format(index)
            filepath = os.path.join(os.path.dirname(output_path), filename)
            try:
                export_bodies(session, [body], filepath)
                meshes.append({'id': node_id, 'file': filename})
            except Exception as error:
                separate_error = str(error)
                break
        manifest = {
            'root': root,
            'partInfo': get_part_information(part),
            'geometryMode': 'separate' if separate_error is None else 'combined',
            'meshes': meshes if separate_error is None else [],
        }
        if separate_error:
            manifest['warning'] = 'Individual NX body export is unavailable; showing complete model geometry.'
        record_stage(stage_path, 'writing NX hierarchy manifest')
        with io.open(manifest_path, 'w', encoding='utf-8') as stream:
            json.dump(manifest, stream, ensure_ascii=False)
        record_stage(stage_path, 'completed NX export')
    finally:
        if load_status is not None:
            load_status.Dispose()


def main():
    args = journal_arguments()
    if len(args) not in (2, 3, 4):
        raise RuntimeError('Expected PRT input, STL output, hierarchy JSON and optional progress log.')
    paths = [os.path.abspath(value.strip('"')) for value in args]
    stage_path = paths[3] if len(paths) == 4 else None
    try:
        export(*paths)
    except Exception:
        record_stage(stage_path, 'exception during NX export')
        error_path = os.path.splitext(paths[1])[0] + '.error.txt'
        with io.open(error_path, 'w', encoding='utf-8') as stream:
            stream.write(traceback.format_exc())
        raise


if __name__ == '__main__':
    main()
