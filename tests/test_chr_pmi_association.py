"""MS43: CHR instances must resolve to the correct PMI without guessing."""
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'nx'))
from inspector_gateway import _record_for_instance


def pmi(identifier, size, tags=(), associated=()):
    return {'id': identifier, 'details': {'Size': size},
            'sourceTags': list(tags), 'associatedTags': list(associated),
            'position': [float(size), 0, 1], 'meshId': 'b1'}


def instance(identifier, nominal, features=()):
    obj = types.SimpleNamespace(DisplayIdentifier=identifier,
        GetDimensionSemantics=lambda: types.SimpleNamespace(Nominal=types.SimpleNamespace(Value=nominal, Precision=1)),
        GetFeature=lambda: list(features), GetUserAttributes=lambda: [])
    return obj


def definition(identifier, reference=None):
    return types.SimpleNamespace(DisplayIdentifier=identifier, ReferenceObject=reference,
                                 GetUserAttributes=lambda: [])


class CharacteristicPmiAssociation(unittest.TestCase):
    def test_unique_nominal_values_link_pc1_and_pc2(self):
        pmis = [pmi('pmi_1', 55), pmi('pmi_2', 12)]
        pc1 = _record_for_instance(definition('PC1'), instance('PC1', 55), 0, pmis)
        pc2 = _record_for_instance(definition('PC2'), instance('PC2', 12), 1, pmis)
        self.assertEqual((pc1['pmiId'], pc2['pmiId']), ('pmi_1', 'pmi_2'))
        self.assertEqual(pc1['position'], pmis[0]['position'])
        self.assertIn('inferred', pc1['associationSource'])

    def test_actual_nx_reference_takes_precedence(self):
        pmis = [pmi('pmi_1', 55, tags=[103]), pmi('pmi_2', 12, tags=[105])]
        obj = _record_for_instance(definition('PC1', types.SimpleNamespace(Tag=103)),
                                   instance('PC1', 12), 0, pmis)
        self.assertEqual(obj['pmiId'], 'pmi_1')
        self.assertNotIn('inferred', obj['associationSource'])

    def test_shared_face_association_uses_unique_pmi(self):
        pmis = [pmi('pmi_1', 55, associated=[301, 302]), pmi('pmi_2', 12, associated=[303])]
        obj = _record_for_instance(definition('PC1'),
                                   instance('PC1', 0, features=[types.SimpleNamespace(Tag=302)]), 0, pmis)
        self.assertEqual(obj['pmiId'], 'pmi_1')
        self.assertEqual(obj['associationSource'], 'NX associated geometry')

    def test_ambiguous_nominal_does_not_link(self):
        pmis = [pmi('pmi_1', 55), pmi('pmi_2', 55)]
        obj = _record_for_instance(definition('PC1'), instance('PC1', 55), 0, pmis)
        self.assertIsNone(obj['pmiId'])
        self.assertIsNone(obj['position'])

    def test_missing_nominal_does_not_invent_link(self):
        pmis = [pmi('pmi_1', 55)]
        obj = _record_for_instance(definition('PC1'), instance('PC1', None), 0, pmis)
        self.assertIsNone(obj['pmiId'])
        self.assertNotIn('Nominal Value', obj['details'])


if __name__ == '__main__':
    unittest.main()
