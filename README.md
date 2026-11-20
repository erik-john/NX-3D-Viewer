# NX 3D Viewer

A local, browser-based viewer for Siemens NX geometry. NX converts supported CAD files to temporary STL meshes; the browser displays and inspects them on **port 8888**.

## Features

- Open **NX `.prt`** and basic **JT `.jt`** files; manage uploads, folders, and ZIP archives in **Workspace**.
- Explore parts and assemblies with the **Item Structure** tree and **Part Inspector**.
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

*MS40 UI preview combined with an earlier real NX assembly capture; illustrative, not a verified JT conversion.*

## Start

1. Run **`Run.bat`** from the project folder, or execute `py -3 backend/server.py`.
2. Open **http://127.0.0.1:8888/** in your browser.
3. Choose **OPEN NX FILES** or use **WORKSPACE** to upload and open a `.prt` / `.jt` file.
4. Press **Ctrl+C** in the terminal to stop the server.

## Supported scope

| Format / capability | Current scope |
| --- | --- |
| **PRT** | Single parts and assemblies via Siemens NX; separate-body controls when exportable. |
| **JT** | Basic `.jt` opening/conversion path implemented; **real NX 1855 JT conversion still needs workstation validation**. Linked JT assemblies are a later milestone. |
| **CHR / STEP** | Not directly supported in the viewer yet. |
| **Measurements** | Approximate results from **STL triangles**, not certified CAD dimensions or exact gear pitch geometry. |
| **Deployment** | Runs locally on `127.0.0.1:8888`; uploaded files persist under `uploads/`. |

## Troubleshooting

| Problem | Check |
| --- | --- |
| `run_journal.exe` not found | Set `NX_RUN_JOURNAL` to its full path (example: `C:\Program Files\Siemens\NX1855\NXBIN\run_journal.exe`) and restart. |
| NX/JT conversion fails | Confirm NX licensing, JT import capability, and required component/reference files. Check logs in `%TEMP%\NX_3D_Viewer\logs`. |
| Individual component actions unavailable | NX may have supplied a **combined STL** rather than separate meshes. |
| Inaccurate measurement | Measurements use tessellated STL; use NX CAD/metrology for exact values. |
| Page does not open | Check that the Python server is running and **port 8888** is available. |

For detailed setup, controls, limits, and troubleshooting, see the **[User Manual](NX_3D_Viewer_User_Manual.docx)**.
