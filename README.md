# NX 3D Viewer

A local, browser-based viewer for Siemens NX geometry. NX converts supported CAD files to temporary STL meshes; the browser displays and inspects them on **port 8888**.

## Features

- Open **NX `.prt`** and **JT `.jt`** files; manage uploads, folders, ZIP archives, and linked JT packages in **Workspace**.
- Explore parts and assemblies with the **Item Structure** tree and **Part Inspector**. The Structure area scrolls horizontally for long component names and vertically for large hierarchies.
- Rotate, pan, zoom, fit, and use isometric/front/top/right views.
- Select, highlight, show/hide, isolate, explode, move, and color individual components when separate meshes are available.
- Apply per-component glass-style transparency and restore all components to solid.
- Measure **CAD-derived cylindrical diameter** from NX PRT analytical faces when available; use approximate STL-based diameter (including sufficiently resolved partial cylinders), centerline spacing, planar distance, and angle otherwise. Selected surface outlines and measurement guides follow the model during camera navigation, Move, and Explode.

## Requirements

- **Windows** and a working, licensed **Siemens NX** installation (target: **NX 2506**) with NX Open / `run_journal.exe`.
- **Python 3.10+** and a browser with **WebGL** support.
- For JT files, the installed NX must support reading the particular JT geometry.

## Screenshot

![NX 3D Viewer — current light-theme interface preview](screenshot.png)

*Illustrative interface preview combined with an NX assembly capture; not a verified JT conversion.*

## Start

1. Run **`Run.bat`** from the project folder, or execute `py -3 backend/server.py`.
2. Open **http://127.0.0.1:8888/** in your browser.
3. Choose **OPEN NX FILES** or use **WORKSPACE** to upload and open a `.prt` / `.jt` file.
4. Press **Ctrl+C** in the terminal to stop the server.

## Supported scope

| Format / capability | Current scope |
| --- | --- |
| **PRT** | Single parts and assemblies via Siemens NX; separate-body controls when exportable. |
| **JT** | Standalone JT and externally linked JT opening via NX. Keep referenced component files in their expected relative folders; Workspace guides upload of parent JT files with companion folders and reviews related files for deletion as a package. Standalone JT can be declared explicitly. Full JT assembly compatibility depends on NX. |
| **CHR** | NX Inspector Characteristics companion files (`.chr`) can be associated with a same-product `.prt` and read through NX Open when its Inspector collection is accessible. Native CHR edits are not supported. |
| **STEP** | Not directly supported. |
| **Measurements** | NX PRT cylindrical faces can provide CAD-derived diameter when the analytical face can be matched uniquely to selected STL facets. Connected faceted half-cylinders can also be measured by a high-confidence circle fit, clearly labeled approximate. Short or ambiguous faceted patches are not treated as cylinders. Other measurements remain approximate; the viewer is not a certified metrology system. |
| **Deployment** | Runs locally on `127.0.0.1:8888`; uploaded files persist under `uploads/`. |

## JT component controls

For separate NX-exported body meshes, each JT occurrence must have a unique mesh ID corresponding to exactly one body node in the NX hierarchy. The viewer reuses existing Selection, Explode, Move, Color, Transparency, and Measurement controls; these operate on triangulated geometry, not exact JT CAD topology. If the NX translator cannot produce a complete, consistent set of separate bodies, the viewer displays a combined STL when possible and disables per-component controls. JT assemblies must still be tested using the installed factory NX version.

## Troubleshooting

| Problem | Check |
| --- | --- |
| `run_journal.exe` not found | Set `NX_RUN_JOURNAL` to its full path (example: `D:\Works\Siemens\NX2506\NXBIN\run_journal.exe`) and restart. |
| NX/JT conversion fails | Restore referenced component files (often a folder matching the parent JT filename). Confirm NX JT support and check `%TEMP%\NX_3D_Viewer\logs`. |
| Individual component actions unavailable | NX may have supplied a **combined STL** rather than separate meshes. |
| Inaccurate measurement | Select a curved cylindrical face in an NX PRT with analytical geometry for CAD-derived diameter; other measurements still use tessellated STL. When an NX analytical face is unavailable, partial cylinders with at least three distinct connected side facets may provide an approximate STL-fitted diameter. If the surface is too sparse or ambiguous, the tool will still show planar-facet measurements. Verify critical values in NX or certified metrology. |
| Page does not open | Check that the Python server is running and **port 8888** is available. |

For detailed setup, controls, limits, and troubleshooting, see the **[User Manual](NX_3D_Viewer_User_Manual.docx)**.

## PMI and NX Inspector Characteristics

For NX `.prt` files, the NX Open export attempts to read PMI annotations and NX Inspector Characteristics and sends any accessible records to the browser with the geometry. The **left Structure tree shows only model parts and components**. Use **PMI** or **Characteristics** in the right-side **Information / PMI / Characteristics** tabs to browse their respective records; clicking an entry highlights the associated annotation in the 3D viewport and reveals its available parameters. The PMI tab is disabled when no records were returned. The Characteristics tab stays available when a matching CHR companion exists, even if NX cannot yet decode its records. The Information tab reports when NX could not access Inspector records, which does not prove they are absent. The PMI tab displays PMI labels and available dimension guides; the Characteristics tab shows Characteristic markers. The Information tab focuses on the selected product or component. Annotation visibility follows the active tab, and the selected entry is emphasized. Labels follow camera navigation and, when NX supplies a geometry association, the component's current Move/Explode offset.

**PMI dimension graphics:** The NX Open journal first tries to extract the real annotation display components using `part.Annotations.CreateComponentData(instance)`. It records their model-space line endpoints, arrow positions and text locations. These are projected into the browser 3D view with the same camera and associated component movement, so line guides remain aligned during rotate, zoom, Fit, Move and Explode. The original PMI text and attribute values are retained; the viewer never substitutes an STL-derived dimension value. If the native NX display components cannot be read, the viewer uses the existing associativity-point guide only when NX provides usable definition points. If neither exists, it displays the saved PMI text without inventing guide lines. The PMI tab reports which source was used. A two-point fallback is not a pixel-identical reproduction of NX's native extension-line layout.

**PMI Dependencies and Details:** Selecting a PMI record displays the NX-reported associated objects and model-view membership in a collapsible Dependencies tree, followed by a parameter table. The exporter reads available dimension Size, Tolerance Type, URL, other dimension properties, and NX object attributes; actual unreported fields are labeled "Not reported by NX" rather than guessed. Duplicate face names are retained when NX identifies distinct faces. When NX exposes Work/Displayed view identities, these are shown next to the model view. Some Siemens NX Navigator labels or fields may be generated internally and might not be returned by NX Open. The read-only diagnostic reports the exact accessible metadata for the installed NX version.

**Characteristic parameters:** Selecting an Inspector Characteristic opens a parameter table showing every supported value returned by NX (including Base ID, Designator, Nominal Value, Status, Unit, Reference and UUID when available). Empty values remain visible in the table. Additional fields returned by NX as attributes are included. A Characteristic is linked to a PMI record only when NX exposes the association.

**Important:** The exact Siemens NX 2506 Inspector API and installed license determine whether Characteristic records can be read by a headless journal. The viewer reports missing access; it does not create fake Characteristics from dimensional PMI. If a Characteristic is present in NX but the viewer shows none, verify the NX Inspector module and use the read-only `dev/nx_inspector_api_probe.py` in your development environment to collect API information. Run `"D:\Works\Siemens\NX2506\NXBIN\run_journal.exe" dev\nx_inspector_api_probe.py -args "C:\path\to\part.prt" "C:\path\to\nx_probe.json"` from this project's directory (adjust both paths). Share the JSON for resolving NX-version-specific Characteristic and PMI methods; the probe does not save or change the PRT. This implementation does not duplicate the complete native NX annotation renderer, datum planes, or every drafting primitive. A linked `.chr` file is now inspected when available, but full data extraction still depends on the NX Inspector runtime API.


## Linked NX Characteristics file

When using **NX Inspector Characteristics**, keep the Characteristics file alongside its source CAD part in the same folder, for example:

```text
Bolt M12x55.prt
Bolt M12x55_chr.chr
```

Opening the `.prt` attempts to open the corresponding `_chr.chr` file through the installed Siemens NX. The viewer then displays records returned by the NX Inspector read-only interface in the **Characteristics** tab. The Information tab shows the linked file name and its extraction status. If NX does not expose the records, the Characteristics tab remains available and explains the extraction limitation; this does not mean the CHR contains no characteristics. The app may list diagnostic designator/UUID candidates that are visible in the binary, clearly distinguished from NX-verified Characteristic instances. These candidates are never used to infer engineering parameter values or PMI links.

The NX Inspector companion is a **native binary**, not an XML or CSV file. Do not edit it with a text editor or use raw string matching for engineering parameter values. The viewer never writes to the `.chr` file. If extraction fails, run the read-only diagnostic against the CHR itself:

```bat
"D:\Works\Siemens\NX2506\NXBIN\run_journal.exe" dev\nx_inspector_api_probe.py -args "C:\path\to\Bolt M12x55_chr.chr" "C:\path\to\chr_probe.json"
```

Alternatively, drag the `.chr` file onto `dev/Run_CHR_Probe.bat` (set `NX_RUN_JOURNAL` first if NX is installed elsewhere). This writes a `_nx_inspector_probe.json` file beside the CHR, even when NX rejects opening it. Share the resulting JSON to identify the exact NX 2506 Inspector interfaces. Uploading `.chr` and `.prt` together into the same **Workspace** folder is supported; to open and visualize the geometry, select the `.prt`. The corresponding CHR file is read-only and will not be automatically deleted or modified when the part is managed.
