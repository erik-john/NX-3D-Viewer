"""Verify associated CHR discovery and safe NX read-only extraction."""
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'nx'))
from chr_export import find_characteristics_part, load_characteristics_part, observed_designators, _opened_part


class Characteristic:
    Designator = 'PC1'
    BaseId = 1
    NominalValue = 55.0

    def GetUserAttributes(self):
        return []


class CHRTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.part = self.root / 'Bolt M12x55.prt'
        self.part.write_bytes(b'PRT model')

    def test_discovers_native_same_product_chr(self):
        companion = self.root / 'BOLT M12x55_CHR.CHR'
        companion.write_bytes(b'SPLMSSTR' + b'\0' * 400 + b'CHRPARTS')
        self.assertEqual(find_characteristics_part(self.part), companion)

    def test_ignores_unrelated_chr(self):
        (self.root / 'Other_chr.chr').write_bytes(b'SPLMSSTR CHRPARTS')
        self.assertIsNone(find_characteristics_part(self.part))

    def test_rejects_wrong_binary(self):
        (self.root / 'Bolt M12x55_chr.chr').write_bytes(b'Not Siemens data')
        with self.assertRaisesRegex(ValueError, 'not recognized'):
            find_characteristics_part(self.part)

    def test_reads_full_characteristic_without_faking_pmi_link(self):
        companion = self.root / 'Bolt M12x55_chr.chr'
        companion.write_bytes(b'SPLMSSTR' + b'\0' * 400 + b'CHRPARTS')
        part = SimpleNamespace(PartUnits='mm', InspectorManager=SimpleNamespace(
            Characteristics=[Characteristic()]))
        class Status:
            disposed = False
            def Dispose(self): self.disposed = True
        status = Status()
        session = SimpleNamespace(Parts=SimpleNamespace(OpenBaseDisplay=lambda _: (part, status)))
        data = {'pmi': [{'id':'pmi_1'}], 'characteristics': [],
                'warnings':['NX Inspector characteristic records were not accessible through the available NX Open collections; this does not mean the part has no Characteristics.']}
        result = load_characteristics_part(session, self.part, data)
        self.assertEqual(result['characteristicsFile']['status'], 'loaded')
        self.assertEqual(result['characteristics'][0]['name'], 'PC1')
        self.assertEqual(result['characteristics'][0]['details']['NominalValue'], '55.0')
        self.assertIsNone(result['characteristics'][0]['pmiId'])
        self.assertEqual(result['warnings'], [])
        self.assertTrue(status.disposed)

    def test_observed_ids_are_diagnostic_only(self):
        companion = self.root / 'Bolt M12x55_chr.chr'
        guid_a = b'b6892285-1c7d-4436-9175-ea3d367983d0'
        guid_b = b'8e0b3489-c244-4a9e-8f97-6e9c33bf0f1e'
        companion.write_bytes(b'SPLMSSTR' + b'\0' * 50 + b'CHRPARTS' +
            b'\0' * 80 + b'PC1\0\x01\x02' + guid_a + b'\0' +
            b'PC2\0\x01\x02' + guid_b + b'\0' + b'55.0\012.0\0')
        hints = observed_designators(companion)
        self.assertEqual([entry['designator'] for entry in hints], ['PC1', 'PC2'])
        data = load_characteristics_part(
            SimpleNamespace(Parts=SimpleNamespace(OpenBaseDisplay=lambda _: SimpleNamespace(FullPath=str(companion)))),
            self.part, {'pmi': [], 'characteristics': [], 'warnings': []})
        self.assertEqual(data['characteristics'], [])
        self.assertEqual(data['characteristicsFile']['status'], 'unavailable')
        self.assertEqual(data['characteristicsFile']['observedDesignators'], hints)
        self.assertTrue(data['warnings'])

    def test_opened_chr_base_part_without_bodies_is_accepted(self):
        marker = SimpleNamespace(FullPath='C:/data/test.chr')
        status = SimpleNamespace(Dispose=lambda: None)
        part, owner = _opened_part((marker, status))
        self.assertIs(part, marker)
        self.assertIs(owner, status)

    def test_raw_characteristic_parameter_strings_are_not_imported(self):
        companion = self.root / 'Bolt M12x55_chr.chr'
        companion.write_bytes(b'SPLMSSTR' + b'\0' * 30 + b'CHRPARTS' +
                              b'\0' * 30 + b'PC3\0' + b'55.0' + b'\0')
        self.assertEqual(observed_designators(companion), [])

    def test_missing_api_does_not_pretend_records_absent(self):
        companion = self.root / 'Bolt M12x55_chr.chr'
        companion.write_bytes(b'SPLMSSTR' + b'\0' * 400 + b'CHRPARTS')
        part = SimpleNamespace(PartUnits='mm')
        session = SimpleNamespace(Parts=SimpleNamespace(OpenBaseDisplay=lambda _: part))
        result = load_characteristics_part(session, self.part, {'pmi': [], 'characteristics': [], 'warnings': []})
        self.assertEqual(result['characteristicsFile']['status'], 'unavailable')
        self.assertEqual(result['characteristics'], [])
        self.assertIn('did not expose', result['warnings'][0])

if __name__ == '__main__': unittest.main()
