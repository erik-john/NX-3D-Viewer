"""MS42: manifest-to-occurrence contract for JT and PRT component features."""
import json
import struct
import tempfile
import unittest
from pathlib import Path
from backend.nx_service import _inspect_manifest


def stl():
    return b'NX component'.ljust(80, b'\0') + struct.pack('<I', 1) + struct.pack(
        '<12fH', 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)


class ComponentContractTests(unittest.TestCase):
    def inspect(self, tree, exported):
        with tempfile.TemporaryDirectory() as dirname:
            folder = Path(dirname)
            combined = folder / 'cad.stl'
            combined.write_bytes(stl())
            meshes = []
            for index, mesh_id in enumerate(exported, 1):
                filename = f'cad_body_{index:05d}.stl'
                (folder / filename).write_bytes(stl())
                meshes.append({'id': mesh_id, 'file': filename})
            manifest = folder / 'cad.json'
            manifest.write_text(json.dumps({'root': tree, 'geometryMode': 'separate',
                                            'meshes': meshes}), encoding='utf-8')
            return _inspect_manifest(manifest, combined)

    def tree(self):
        # Two occurrences of the same prototype must be independently addressable.
        return {'id': 'root', 'type': 'part', 'children': [
            {'id': 'root_c1', 'type': 'component', 'partKey': 'bolt.jt', 'children': [
                {'id': 'root_c1_b1', 'type': 'body', 'meshId': 'root_c1_b1', 'children': []}]},
            {'id': 'root_c2', 'type': 'component', 'partKey': 'bolt.jt', 'children': [
                {'id': 'root_c2_b1', 'type': 'body', 'meshId': 'root_c2_b1', 'children': []}]}]}

    def test_repeated_jt_occurrences_preserve_independent_mesh_ids(self):
        result = self.inspect(self.tree(), ['root_c1_b1', 'root_c2_b1'])
        self.assertTrue(result['valid'], result['reason'])
        self.assertTrue(result['bodyFilesValid'])

    def test_orphaned_mesh_is_rejected(self):
        result = self.inspect(self.tree(), ['root_c1_b1', 'other_b1'])
        self.assertFalse(result['valid'])
        self.assertIn('do not match', result['reason'])

    def test_duplicate_occurrence_geometry_is_rejected(self):
        result = self.inspect(self.tree(), ['root_c1_b1', 'root_c1_b1'])
        self.assertFalse(result['valid'])

    def test_missing_body_export_is_rejected(self):
        result = self.inspect(self.tree(), ['root_c1_b1'])
        self.assertFalse(result['valid'])

    def test_duplicate_tree_node_is_rejected(self):
        tree = self.tree()
        tree['children'][1]['id'] = 'root_c1'
        result = self.inspect(tree, ['root_c1_b1', 'root_c2_b1'])
        self.assertFalse(result['valid'])
        self.assertIn('duplicate', result['reason'])


if __name__ == '__main__':
    unittest.main()
