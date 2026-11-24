"""Verify NXOpen metadata extraction for the PMI/Characteristics integration."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'nx'))
from pmi_export import extract_annotations, point, dimension_geometry
from pmi_presentation import extract_presentation


class PmiInstance:
    Name = 'Linear Dimension'
    AnnotationOrigin = SimpleNamespace(X=20, Y=30, Z=40)

    def GetDimensionText(self):
        return (['55'], [])

    def GetUserAttributes(self):
        return []


class Pmi:
    Name = 'Linear Dimension'

    def GetDisplayInstances(self):
        return [PmiInstance()]

    def GetUserAttributes(self):
        return []


class Characteristic:
    Designator = 'PC1'
    BaseId = 1
    Index = 0
    Inspection = False
    NominalPrecision = 1
    NominalValue = 55

    def GetUserAttributes(self):
        return []


class PmiTests(unittest.TestCase):
    def test_real_pmi_dimension_text_and_location(self):
        part = SimpleNamespace(PmiManager=SimpleNamespace(Pmis=[Pmi()]))
        result = extract_annotations(part)
        self.assertEqual(len(result['pmi']), 1)
        self.assertEqual(result['pmi'][0]['text'], '55')
        self.assertEqual(result['pmi'][0]['position'], [20, 30, 40])
        self.assertEqual(result['characteristics'], [])
        self.assertIn('not accessible', result['warnings'][0])

    def test_explicit_characteristic_collection_preserves_metadata(self):
        part = SimpleNamespace(PmiManager=SimpleNamespace(Pmis=[Pmi()]),
                               InspectorManager=SimpleNamespace(Characteristics=[Characteristic()]))
        result = extract_annotations(part)
        self.assertEqual(result['characteristics'][0]['name'], 'PC1')
        self.assertEqual(result['characteristics'][0]['details']['BaseId'], '1')
        self.assertEqual(result['characteristics'][0]['details']['NominalValue'], '55')


    def test_pmi_dimensions_dependencies_and_saved_details(self):
        pt = lambda x: SimpleNamespace(X=x, Y=0, Z=0)
        class Face:
            def __init__(self, tag):
                self.Tag = tag
                self.Name = 'Face of Base rotate 1'
        view = SimpleNamespace(Tag=901, Name='Trimetric')
        class Display:
            ComputedSize = 55.0
            ToleranceType = 'ToleranceTypeNone'
            URL = ''
            def GetViews(self): return [view]
            def GetDimensionText(self): return (['55'], [])
        class PmiWithDependencies:
            Name = 'Linear Dimension (2)'
            def GetDisplayInstances(self): return [Display()]
            def GetAssociatedObject(self):
                return SimpleNamespace(GetObjects=lambda: [Face(81), Face(82)])
        part = SimpleNamespace(
            PmiManager=SimpleNamespace(Pmis=[PmiWithDependencies()]),
            ModelingViews=SimpleNamespace(WorkView=view, DisplayedView=view))
        record = extract_annotations(part)['pmi'][0]
        self.assertEqual(record['details']['Size'], 55.0)
        self.assertEqual(record['details']['Tolerance Type'], 'No Tolerance')
        self.assertEqual(record['details']['URL'], '')
        self.assertEqual(record['associatedTags'], [81, 82])
        deps = record['dependencies']
        self.assertEqual([x['name'] for x in deps['associatedObjects']],
                         ['Face of Base rotate 1', 'Face of Base rotate 1'])
        self.assertEqual(deps['modelViews'][0]['name'], 'Trimetric')
        self.assertTrue(deps['modelViews'][0]['work'])
        self.assertTrue(deps['modelViews'][0]['displayed'])

    def test_missing_dimension_data_is_not_guessed(self):
        record = extract_annotations(SimpleNamespace(PmiManager=SimpleNamespace(Pmis=[Pmi()])))['pmi'][0]
        self.assertNotIn('Size', record['details'])
        self.assertNotIn('Tolerance Type', record['details'])
        self.assertEqual(record['dependencies']['associatedObjects'], [])
        self.assertEqual(record['dependencies']['modelViews'], [])

    def test_native_nx_display_components_are_used_without_invented_geometry(self):
        pt = lambda x, y, z: SimpleNamespace(X=x, Y=y, Z=z)
        lines = [SimpleNamespace(StartPoint=pt(0, 15, 0), EndPoint=pt(0, 0, 0), Type='Extension'),
                 SimpleNamespace(StartPoint=pt(55, 15, 0), EndPoint=pt(55, 0, 0), Type='Extension'),
                 SimpleNamespace(StartPoint=pt(0, 15, 0), EndPoint=pt(55, 15, 0), Type='Dimension')]
        arrows = [SimpleNamespace(Origin=pt(0, 15, 0), Type='Filled'),
                  SimpleNamespace(Origin=pt(55, 15, 0), Type='Filled')]
        text = [SimpleNamespace(AdjustedOrigin=pt(27.5, 19, 0),
                                GetText=lambda: ['55'])]
        class ComponentData:
            def GetLineComponents(self): return lines
            def GetArrowComponents(self): return arrows
            def GetTextComponents(self): return text
        instance = SimpleNamespace(AnnotationOrigin=pt(27.5, 19, 0),
                                   GetDimensionText=lambda: (['55'], []))
        pmi = SimpleNamespace(Name='Linear Dimension',
            GetDisplayInstances=lambda: [instance], GetUserAttributes=lambda: [])
        part = SimpleNamespace(PmiManager=SimpleNamespace(Pmis=[pmi]),
            Annotations=SimpleNamespace(CreateComponentData=lambda candidate: ComponentData()))
        result = extract_annotations(part)
        record = result['pmi'][0]
        self.assertEqual(record['position'], [27.5, 19, 0])
        self.assertEqual(record['text'], '55')
        self.assertEqual(len(record['presentation']['lines']), 3)
        self.assertEqual(len(record['presentation']['arrows']), 2)
        self.assertEqual(record['presentation']['texts'][0]['text'], '55')
        self.assertEqual(record['presentation']['lines'][2]['end'], [55, 15, 0])
        self.assertIsNone(record['dimension'])
        self.assertFalse(any('reference lines are unavailable' in warning for warning in result['warnings']))

    def test_native_component_data_failure_preserves_no_fabrication(self):
        instance = SimpleNamespace(AnnotationOrigin=SimpleNamespace(X=0, Y=0, Z=0))
        part = SimpleNamespace(Annotations=SimpleNamespace(
            CreateComponentData=lambda candidate: (_ for _ in ()).throw(RuntimeError('unsupported'))))
        self.assertIsNone(extract_presentation(part, [instance]))
        self.assertIsNone(extract_presentation(SimpleNamespace(), [instance]))

    def test_never_invents_characteristic_from_pmi_dimension(self):
        part = SimpleNamespace(PmiManager=SimpleNamespace(Pmis=[Pmi()]))
        self.assertFalse(extract_annotations(part)['characteristics'])

    def test_invalid_position_not_projected(self):
        self.assertIsNone(point([float('nan'), 0, 0]))
        self.assertIsNone(point('garbage'))

    def test_linear_dimension_uses_nx_associativity_and_origin(self):
        origin = SimpleNamespace(X=10, Y=15, Z=7)
        first = SimpleNamespace(FirstDefinitionPoint=SimpleNamespace(X=0, Y=0, Z=7))
        second = SimpleNamespace(FirstDefinitionPoint=SimpleNamespace(X=55, Y=0, Z=7))
        instance = SimpleNamespace(AnnotationOrigin=origin,
                                   GetFirstAssociativity=lambda: first,
                                   GetSecondAssociativity=lambda: second)
        pmi = SimpleNamespace(Name='Dimension 55', Tag=101,
                              GetDisplayInstances=lambda: [instance],
                              GetDimensionText=lambda: (['55'], []),
                              GetUserAttributes=lambda: [])
        class SavedCharacteristic:
            Designator = 'PC1'
            BaseId = 1
            Basic = False
            Index = 0
            ExtensionId = ''
            Inspection = False
            NominalPrecision = 1
            NominalValue = 55.0
            Reference = False
            Status = 'Retained'
            Type = 'Linear Dimension'
            Unit = 'Millimeter'
            UUID = 'b6892285-1c7d-443'
            def GetAssociatedPmi(self): return pmi
            def GetUserAttributes(self): return []
        part = SimpleNamespace(PmiManager=SimpleNamespace(Pmis=[pmi]),
                               InspectorManager=SimpleNamespace(Characteristics=[SavedCharacteristic()]))
        annotations = extract_annotations(part)
        self.assertEqual(annotations['pmi'][0]['dimension']['start'], [0, 0, 7])
        self.assertEqual(annotations['pmi'][0]['dimension']['end'], [55, 0, 7])
        self.assertEqual(annotations['pmi'][0]['dimension']['origin'], [10, 15, 7])
        characteristic = annotations['characteristics'][0]
        self.assertEqual(characteristic['pmiId'], 'pmi_1')
        self.assertEqual(characteristic['position'], [10, 15, 7])
        details = characteristic['details']
        self.assertEqual(details['Status'], 'Retained')
        self.assertEqual(details['Unit'], 'Millimeter')
        self.assertEqual(details['Reference'], 'No')
        self.assertIn('UUID', details)

    def test_dimension_get_associativity_fallback(self):
        point3 = lambda x: SimpleNamespace(X=x, Y=0, Z=0)
        refs = [SimpleNamespace(FirstDefinitionPoint=point3(0)),
                SimpleNamespace(FirstDefinitionPoint=point3(55))]
        item = SimpleNamespace(AnnotationOrigin=point3(25),
            NumberOfAssociativities=2,
            GetAssociativity=lambda index: refs[index] if index < 2 else None)
        result = dimension_geometry(SimpleNamespace(), [item])
        self.assertEqual(result['start'], [0, 0, 0])
        self.assertEqual(result['end'], [55, 0, 0])

    def test_definition_points_in_one_nx_associativity(self):
        pt = lambda x: SimpleNamespace(X=x, Y=0, Z=0)
        assoc = SimpleNamespace(FirstDefinitionPoint=pt(0), SecondDefinitionPoint=pt(12))
        item = SimpleNamespace(AnnotationOrigin=pt(6), GetFirstAssociativity=lambda: assoc)
        result = dimension_geometry(SimpleNamespace(), [item])
        self.assertEqual(result['end'], [12, 0, 0])

    def test_actual_reference_points_without_annotation_origin(self):
        point3 = lambda x: SimpleNamespace(X=x, Y=0, Z=0)
        first = SimpleNamespace(FirstDefinitionPoint=point3(0))
        second = SimpleNamespace(FirstDefinitionPoint=point3(55))
        item = SimpleNamespace(GetFirstAssociativity=lambda: first,
                               GetSecondAssociativity=lambda: second)
        result = dimension_geometry(item, [])
        self.assertEqual(result['start'], [0, 0, 0])
        self.assertEqual(result['end'], [55, 0, 0])
        self.assertIsNone(result['origin'])
        self.assertIn('placement unavailable', result['source'])

    def test_no_fabricated_dimension_without_two_real_associations(self):
        instance = SimpleNamespace(AnnotationOrigin=SimpleNamespace(X=0, Y=15, Z=0),
                                   GetFirstAssociativity=lambda: SimpleNamespace(
                                       FirstDefinitionPoint=SimpleNamespace(X=0, Y=0, Z=0)))
        self.assertIsNone(dimension_geometry(instance, []))
        self.assertIsNone(dimension_geometry(SimpleNamespace(), []))


if __name__ == '__main__':
    unittest.main()
