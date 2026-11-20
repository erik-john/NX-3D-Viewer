# NX 3D Viewer

A local, browser-based viewer for Siemens NX geometry. NX converts supported CAD files to temporary STL meshes; the browser displays and inspects them on **port 8888**.

## Features

- Open **NX `.prt`** and **JT `.jt`** files; manage uploads, folders, ZIP archives, and linked JT packages in **Workspace**.
- Explore parts and assemblies with the **Item Structure** tree and **Part Inspector**. The Structure area scrolls horizontally for long component names and vertically for large hierarchies.
- Rotate, pan, zoom, fit, and use isometric/front/top/right views.
- Select, highlight, show/hide, isolate, explode, move, and color individual components when separate meshes are available.
- Apply per-component glass-style transparency and restore all components to solid.
- Measure approximate **diameter, centerline spacing, face distance, and face angle** from triangulated geometry.

## Requirements

- **Windows** and a working, licensed **Siemens NX** installation (target: **NX 1855**) with NX Open / `run_journal.exe`.
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
| **CHR / STEP** | Not directly supported in the viewer yet. |
| **Measurements** | Approximate results from **STL triangles**, not certified CAD dimensions or exact gear pitch geometry. |
| **Deployment** | Runs locally on `127.0.0.1:8888`; uploaded files persist under `uploads/`. |

## JT component controls

For separate NX-exported body meshes, each JT occurrence must have a unique mesh ID corresponding to exactly one body node in the NX hierarchy. The viewer reuses existing Selection, Explode, Move, Color, Transparency, and Measurement controls; these operate on triangulated geometry, not exact JT CAD topology. If the NX translator cannot produce a complete, consistent set of separate bodies, the viewer displays a combined STL when possible and disables per-component controls. JT assemblies must still be tested using the licensed NX 1855 installation.

## Troubleshooting

| Problem | Check |
| --- | --- |
| `run_journal.exe` not found | Set `NX_RUN_JOURNAL` to its full path (example: `C:\Program Files\Siemens\NX1855\NXBIN\run_journal.exe`) and restart. |
| NX/JT conversion fails | Restore referenced component files (often a folder matching the parent JT filename). Confirm NX JT support and check `%TEMP%\NX_3D_Viewer\logs`. |
| Individual component actions unavailable | NX may have supplied a **combined STL** rather than separate meshes. |
| Inaccurate measurement | Measurements use tessellated STL; use NX CAD/metrology for exact values. |
| Page does not open | Check that the Python server is running and **port 8888** is available. |

For detailed setup, controls, limits, and troubleshooting, see the **[User Manual](NX_3D_Viewer_User_Manual.docx)**.
