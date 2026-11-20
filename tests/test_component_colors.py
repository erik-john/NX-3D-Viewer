"""MS30: NX Open prototype identity for color grouping across occurrences."""
import importlib.util
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('nx_journal', ROOT / 'nx/export_stl.py')
journal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journal)


class Body:
    def __init__(self, tag):
        self.Tag = tag
        self.Name = 'Solid'


class Component:
    def __init__(self, proto=None, tag=0, children=None):
        self.Prototype = proto
        self.Name = 'Occurrence {}'.format(tag)
        self._tag = tag
        self._children = children or []

    def GetChildren(self):
        return self._children

    def FindOccurrence(self, proto_body):
        return Body(self._tag * 100 + proto_body.Tag)


class ColorPrototypeTests(unittest.TestCase):
    def test_repeated_prototype_identity_and_distinct_sizes(self):
        bolt = types.SimpleNamespace(FullPath=r'C:\\Parts\\Bolt_M6x20.prt',
                                     Bodies=[Body(1), Body(2)])
        other = types.SimpleNamespace(FullPath=r'C:\\Parts\\Bolt_M6x30.prt',
                                      Bodies=[Body(1)])
        children = [Component(bolt, 1), Component(bolt, 2), Component(other, 3)]
        nxpart = types.SimpleNamespace(Name='Fastener Assembly', Bodies=[],
                    ComponentAssembly=types.SimpleNamespace(
                        RootComponent=Component(children=children)))
        tree, bodies, leaves = journal.build_structure(nxpart)
        self.assertEqual(5, len(bodies))
        self.assertEqual(5, len(leaves))
        keys = [node['partKey'] for node in tree['children']]
        self.assertEqual(keys[0], keys[1])
        self.assertNotEqual(keys[0], keys[2])
        self.assertEqual(2, len(tree['children'][0]['children']))

    def test_unsaved_prototype_uses_name_without_mandatory_path(self):
        proto = types.SimpleNamespace(Name='Bearing_6000', Bodies=[Body(1)])
        nxpart = types.SimpleNamespace(Name='Assembly', Bodies=[],
            ComponentAssembly=types.SimpleNamespace(RootComponent=Component(children=[Component(proto,1)])))
        tree, _, _ = journal.build_structure(nxpart)
        self.assertEqual('Bearing_6000', tree['children'][0]['partKey'])


if __name__ == '__main__':
    unittest.main()
