"""Export displayed part bodies using the NX Open journal runtime."""

import os
import sys
import traceback
import io


def journal_arguments():
    args = sys.argv
    if "-args" in args:
        return args[args.index("-args") + 1:]
    return args[1:]


def bodies_for_export(part):
    bodies = []
    seen = set()

    def add(body):
        try:
            tag = int(body.Tag)
        except Exception:
            tag = id(body)
        if tag not in seen:
            seen.add(tag)
            bodies.append(body)

    for body in part.Bodies:
        add(body)

    assembly = getattr(part, "ComponentAssembly", None)
    root = getattr(assembly, "RootComponent", None) if assembly else None
    if root:
        def walk(component):
            prototype = component.Prototype
            if prototype is None or not hasattr(prototype, "Bodies"):
                raise RuntimeError("A component is not loaded. Load all assembly components in NX and try again.")
            for body in prototype.Bodies:
                occurrence = component.FindOccurrence(body)
                if occurrence is None:
                    raise RuntimeError("Could not resolve an assembly body position. Load the component fully in NX.")
                if int(occurrence.Tag) == int(body.Tag):
                    raise RuntimeError("NX returned a prototype body instead of a positioned assembly body.")
                add(occurrence)
            for child in component.GetChildren():
                walk(child)

        for child in root.GetChildren():
            walk(child)
    return bodies


def export(input_path, output_path):
    import NXOpen

    session = NXOpen.Session.GetSession()
    opened = session.Parts.OpenBaseDisplay(input_path)
    if isinstance(opened, tuple):
        part = next((item for item in opened if hasattr(item, "Bodies")), None)
        load_status = next((item for item in opened if hasattr(item, "Dispose") and not hasattr(item, "Bodies")), None)
    else:
        part, load_status = opened, None
    try:
        if part is None:
            raise RuntimeError("NX could not open the selected part.")
        bodies = bodies_for_export(part)
        if not bodies:
            raise RuntimeError("No solid or sheet bodies were found in the selected NX part.")

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
        if not os.path.isfile(output_path) or os.path.getsize(output_path) < 84:
            raise RuntimeError("NX STL export did not generate any geometry.")
    finally:
        if load_status is not None:
            load_status.Dispose()


def main():
    args = journal_arguments()
    if len(args) != 2:
        raise RuntimeError("Expected the PRT input path and STL output path.")
    input_path, output_path = [os.path.abspath(value.strip('"')) for value in args]
    try:
        export(input_path, output_path)
    except Exception:
        error_path = os.path.splitext(output_path)[0] + ".error.txt"
        with io.open(error_path, "w", encoding="utf-8") as stream:
            stream.write(traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
