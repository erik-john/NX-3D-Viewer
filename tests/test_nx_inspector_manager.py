"""Read-only NX Inspector Manager / CharacteristicsPart regression tests."""
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'nx'))
from inspector_gateway import read_inspector_records
from chr_export import load_characteristics_part


class Value:
    def __init__(self, value, precision=None):
        self.Value = value
        self.Precision = precision


class ProductCharacteristicInstance:
    DisplayIdentifier = 'PC1'
    UniversallyUniqueIdentifier = 'b6892285-1c7d-4436-9175-ea3d367983d0'

    def GetDimensionSemantics(self):
        return types.SimpleNamespace(Nominal=Value(55.0, 1),
                                     UpperTolerance=Value(0.005),
                                     LowerTolerance=Value(-0.005))

    def GetFeature(self):
        return [types.SimpleNamespace(Tag=101, Name='Face of Bolt')]

    def GetUserAttributes(self):
        return []


class ProductCharacteristic:
    DisplayIdentifier = 'PC1'
    Name = 'Linear Dimension (PC1)'

    def GetInstances(self):
        return [ProductCharacteristicInstance()]

    def GetUserAttributes(self):
        return []


class InspectorManagerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.part_file = self.root / 'Bolt M12x55.prt'
        self.part_file.write_bytes(b'PRT')
        self.chr_file = self.root / 'Bolt M12x55_chr.chr'
        self.chr_file.write_bytes(b'SPLMSSTR' + b'\0'*400 + b'CHRPARTS')

    def manager_context(self, manager):
        inspector = types.ModuleType('NXOpen.Inspector')
        inspector.Manager = types.SimpleNamespace(GetManager=lambda session: manager)
        nx_open = types.ModuleType('NXOpen')
        nx_open.Inspector = inspector
        return patch.dict(sys.modules, {'NXOpen': nx_open, 'NXOpen.Inspector': inspector})

    def test_manager_get_characteristic_part_and_instance_semantics(self):
        characteristic_part = types.SimpleNamespace(GetCharacteristics=lambda: [ProductCharacteristic()])
        design_part = types.SimpleNamespace(FullPath=str(self.part_file))
        manager = types.SimpleNamespace(GetCharacteristicPart=lambda part: characteristic_part,
                                        CharacteristicsCollection=None)
        opened_part = types.SimpleNamespace(FullPath=str(self.chr_file))
        session = types.SimpleNamespace(Parts=types.SimpleNamespace(OpenBaseDisplay=lambda path: opened_part,
                                                                    Work=design_part, Display=opened_part))
        with self.manager_context(manager):
            result = load_characteristics_part(session, self.part_file,
                        {'pmi': [], 'characteristics': [], 'warnings': []}, design_part=design_part)
        self.assertEqual(result['characteristicsFile']['status'], 'loaded')
        self.assertEqual(len(result['characteristics']), 1)
        chr1 = result['characteristics'][0]
        self.assertEqual(chr1['name'], 'PC1')
        self.assertEqual(chr1['details']['Nominal Value'], '55.0')
        self.assertEqual(chr1['details']['Nominal Precision'], '1')
        self.assertEqual(chr1['details']['Upper Tolerance'], '0.005')
        self.assertEqual(chr1['details']['UUID'], 'b6892285-1c7d-4436-9175-ea3d367983d0')
        self.assertEqual(chr1['features'][0]['tag'], 101)
        self.assertIsNone(chr1['pmiId'])

    def test_missing_inspector_license_leaves_data_unverified(self):
        design_part = types.SimpleNamespace(FullPath=str(self.part_file))
        manager = types.SimpleNamespace(GetCharacteristicPart=lambda part: (_ for _ in ()).throw(
            RuntimeError('nx_inspector license unavailable')), CharacteristicsCollection=None)
        session = types.SimpleNamespace(Parts=types.SimpleNamespace(Work=design_part, Display=None))
        with self.manager_context(manager):
            records, messages = read_inspector_records(session, design_part, None, [])
        self.assertEqual(records, [])
        self.assertIn('nx_inspector', ' '.join(messages))

    def test_direct_characteristic_part_accessor_without_manager_lookup(self):
        opened = types.SimpleNamespace(GetCharacteristics=lambda: [ProductCharacteristic()])
        manager = types.SimpleNamespace(GetCharacteristicPart=lambda part: None,
                                        CharacteristicsCollection=None)
        session = types.SimpleNamespace(Parts=types.SimpleNamespace(Work=None, Display=None))
        with self.manager_context(manager):
            records, messages = read_inspector_records(session, None, opened, [])
        self.assertEqual(records[0]['name'], 'PC1')
        self.assertEqual(messages, [])

    def test_no_characteristic_values_invented(self):
        class EmptyInstance:
            DisplayIdentifier = 'PC2'
            def GetUserAttributes(self): return []
        class EmptyDefinition:
            def GetInstances(self): return [EmptyInstance()]
        opened = types.SimpleNamespace(GetCharacteristics=lambda: [EmptyDefinition()])
        manager = types.SimpleNamespace(GetCharacteristicPart=lambda part: None,
                                        CharacteristicsCollection=None)
        session = types.SimpleNamespace(Parts=types.SimpleNamespace(Work=None, Display=None))
        with self.manager_context(manager):
            records, _ = read_inspector_records(session, None, opened, [])
        self.assertEqual(records[0]['name'], 'PC2')
        self.assertNotIn('Nominal Value', records[0]['details'])

if __name__ == '__main__':
    unittest.main()
