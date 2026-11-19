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
