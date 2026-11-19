"""Validate NX Open geometry selection with NX-shaped objects."""

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('nx_export_journal', ROOT / 'nx/export_stl.py')
journal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journal)


class Body:
    def __init__(self, tag):
        self.Tag = tag


class Component:
    def __init__(self, prototype=None, children=None, occurrences=None):
        self.Prototype = prototype
        self.children = children or []
        self.occurrences = occurrences or {}

    def GetChildren(self):
        return self.children

    def FindOccurrence(self, prototype):
        return self.occurrences.get(prototype.Tag)


class JournalTests(unittest.TestCase):
    def test_part_bodies(self):
        part = types.SimpleNamespace(Bodies=[Body(1), Body(2)], ComponentAssembly=None)
        self.assertEqual([1, 2], [body.Tag for body in journal.bodies_for_export(part)])

    def test_reused_assembly_part_exports_each_occurrence(self):
        prototype = Body(12)
        leaf_part = types.SimpleNamespace(Bodies=[prototype])
        instances = [Component(leaf_part, occurrences={12: Body(100)}),
                     Component(leaf_part, occurrences={12: Body(200)})]
        root = Component(children=instances)
        assembly = types.SimpleNamespace(Bodies=[], ComponentAssembly=types.SimpleNamespace(RootComponent=root))
        self.assertEqual([100, 200], [body.Tag for body in journal.bodies_for_export(assembly)])

    def test_missing_occurrence_fails(self):
        prototype = Body(12)
        part = types.SimpleNamespace(Bodies=[], ComponentAssembly=types.SimpleNamespace(
            RootComponent=Component(children=[Component(types.SimpleNamespace(Bodies=[prototype]))])))
        with self.assertRaisesRegex(RuntimeError, 'assembly body position'):
            journal.bodies_for_export(part)

    def test_inspector_part_units_and_attributes(self):
        import types
        part = types.SimpleNamespace(
            PartUnits='Part.Units.Millimeters',
            GetUserAttributes=lambda: [
                types.SimpleNamespace(Title='Material', Type='String', StringValue='Steel'),
                types.SimpleNamespace(Title='Revision', Type='Integer', IntegerValue=3),
            ],
        )
        info = journal.get_part_information(part)
        self.assertEqual('mm', info['units'])
        self.assertEqual([{'name': 'Material', 'value': 'Steel'},
                          {'name': 'Revision', 'value': '3'}], info['attributes'])
        self.assertEqual({'units': None, 'attributes': []},
                         journal.get_part_information(types.SimpleNamespace()))

    def test_tree_preserves_repeated_component_instances(self):
        prototype = Body(12)
        prototype.Name = 'Bolt Body'
        source_part = types.SimpleNamespace(Bodies=[prototype])
        instances = [Component(source_part, occurrences={12: Body(101)}),
                     Component(source_part, occurrences={12: Body(202)})]
        instances[0].Name = 'Bolt A'
        instances[1].Name = 'Bolt B'
        part = types.SimpleNamespace(Bodies=[], Name='Fastener Assembly',
                                     ComponentAssembly=types.SimpleNamespace(
                                         RootComponent=Component(children=instances)))
        root, bodies, leaves = journal.build_structure(part)
        self.assertEqual('Fastener Assembly', root['name'])
        self.assertEqual(['Bolt A', 'Bolt B'], [child['name'] for child in root['children']])
        self.assertEqual([101, 202], [body.Tag for body in bodies])
        self.assertEqual(['root_c1_b1', 'root_c2_b1'], [item[0] for item in leaves])
        self.assertEqual('Bolt Body', root['children'][0]['children'][0]['name'])

    def test_nx_stl_builder_writes_structure_manifest(self):
        body = Body(42)
        part = types.SimpleNamespace(Bodies=[body], Name='Mount', ComponentAssembly=None)
        created = []
        class Creator:
            def __init__(self):
                self.ExportSelectionBlock = types.SimpleNamespace(Add=self.add)
                self.selected = []
                created.append(self)
            def add(self, value):
                self.selected.append(value)
            def Commit(self):
                Path(self.OutputFile).write_bytes(b'X' * 134)
            def Destroy(self):
                pass
        session = types.SimpleNamespace(
            Parts=types.SimpleNamespace(OpenBaseDisplay=lambda path: part),
            DexManager=types.SimpleNamespace(CreateStlCreator=Creator),
        )
        fake_nx = types.SimpleNamespace(
            Session=types.SimpleNamespace(GetSession=lambda: session),
            STLCreator=types.SimpleNamespace(OutputTypeEnum=types.SimpleNamespace(Binary='binary')),
        )
        import json
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, {'NXOpen': fake_nx}):
            combined = str(Path(tmp) / ('a' * 32 + '.stl'))
            manifest = str(Path(tmp) / ('a' * 32 + '.json'))
            journal.export('test.prt', combined, manifest)
            payload = json.loads(Path(manifest).read_text())
        self.assertEqual('separate', payload['geometryMode'])
        self.assertEqual('Mount', payload['root']['name'])
        self.assertEqual('root_b1', payload['meshes'][0]['id'])
        self.assertEqual(2, len(created))
        self.assertEqual([body], created[0].selected)
        self.assertEqual([body], created[1].selected)

    def test_failed_body_stl_keeps_complete_combined_model(self):
        import json
        body = Body(55)
        part = types.SimpleNamespace(Bodies=[body], Name='Part', ComponentAssembly=None)
        exports = []
        class Creator:
            def __init__(self):
                self.ExportSelectionBlock = types.SimpleNamespace(Add=lambda item: None)
                exports.append(self)
            def Commit(self):
                if len(exports) > 1:
                    raise RuntimeError('Body conversion unavailable')
                Path(self.OutputFile).write_bytes(b'X' * 134)
            def Destroy(self):
                pass
        session = types.SimpleNamespace(
            Parts=types.SimpleNamespace(OpenBaseDisplay=lambda _: part),
            DexManager=types.SimpleNamespace(CreateStlCreator=Creator),
        )
        fake_nx = types.SimpleNamespace(
            Session=types.SimpleNamespace(GetSession=lambda: session),
            STLCreator=types.SimpleNamespace(OutputTypeEnum=types.SimpleNamespace(Binary='binary')),
        )
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, {'NXOpen': fake_nx}):
            combined = Path(tmp) / ('a' * 32 + '.stl')
            manifest = combined.with_suffix('.json')
            journal.export('test.prt', str(combined), str(manifest))
            data = json.loads(manifest.read_text())
            self.assertEqual('combined', data['geometryMode'])
            self.assertTrue(data['warning'])
            self.assertEqual([], data['meshes'])
            self.assertTrue(combined.is_file())

    def test_nx_stl_builder(self):
        body = Body(42)
        load = types.SimpleNamespace(Dispose=lambda: None)
        class Creator:
            def __init__(self):
                self.ExportSelectionBlock = types.SimpleNamespace(Add=self.add)
                self.selected = []
            def add(self, value):
                self.selected.append(value)
            def Commit(self):
                Path(self.OutputFile).write_bytes(b'X' * 134)
            def Destroy(self):
                self.destroyed = True
        creator = Creator()
        session = types.SimpleNamespace(
            Parts=types.SimpleNamespace(OpenBaseDisplay=lambda path: (types.SimpleNamespace(Bodies=[body], ComponentAssembly=None), load)),
            DexManager=types.SimpleNamespace(CreateStlCreator=lambda: creator),
        )
        fake_nx = types.SimpleNamespace(
            Session=types.SimpleNamespace(GetSession=lambda: session),
            STLCreator=types.SimpleNamespace(OutputTypeEnum=types.SimpleNamespace(Binary='binary')),
        )
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, {'NXOpen': fake_nx}):
            dest = str(Path(tmp) / 'temp.stl')
            journal.export(str(Path(tmp) / 'input.prt'), dest)
            self.assertEqual([body], creator.selected)
            self.assertEqual('binary', creator.OutputType)
            self.assertTrue(creator.destroyed)
            self.assertTrue(Path(dest).is_file())


if __name__ == '__main__':
    unittest.main()
