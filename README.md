# NX 3D Viewer

A local browser-based 3D viewer for Siemens NX part geometry. It runs on your computer with a Python server and a WebGL browser interface, using **port 8888**.

## Features

- Open Siemens NX **`.prt`** files from the server computer and visualize their geometry.
- Render NX geometry as tessellated STL surfaces; original NX files are not changed.
- Rotate, pan, zoom, fit to view, and switch between isometric, front, top, and right views.
- Toggle the reference grid, coordinate axes, and wireframe display.
- Explore built-in mechanical sample geometry without opening NX.
- Use a local Python server and bundled frontend code, without external JavaScript packages or a cloud service.

## Requirements

- Windows with a working, licensed Siemens NX installation (NX 1855 is the target configuration) for opening `.prt` files.
- Python 3.10 or newer.
- A browser with WebGL support.

The sample scenes work without Siemens NX. Actual `.prt` conversion requires NX Open and its `run_journal.exe` program. An NX installation may also need the proper assembly component files and licensing available on the same computer.

## Project structure

```text
NX-3D-Viewer/
├── backend/
│   ├── server.py
│   └── nx_service.py
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       ├── geometry.js
│       ├── stl.js
│       └── viewer.js
├── nx/
│   └── export_stl.py
├── Run.bat
├── .gitignore
├── README.md
└── VERSION.txt
```

## Start

1. Open the project folder on your Windows computer.
2. Double-click **`Run.bat`**, or run `py -3 backend/server.py` in a terminal.
3. Open **http://127.0.0.1:8888/** in your browser.
4. Press **Ctrl+C** in the terminal to stop the server.

The server listens only on the local computer. Port **8888** is fixed.

## Open an NX file

1. Click **OPEN NX .PRT** in the toolbar.
2. Choose a `.prt` file using the file selection dialog on the **computer running the Python server**.
3. The viewer asks Siemens NX to open the part and create a temporary STL representation.
4. The converted geometry appears in the browser when the operation completes.

You can select a built-in scene from the **SCENE** menu at any time. Exported STL files are stored temporarily and removed when the server exits. No conversion overwrites or saves the original `.prt` file.

If NX cannot be found, set the `NX_RUN_JOURNAL` environment variable to the complete path of `run_journal.exe` and restart the server. For example, in PowerShell:

```powershell
$env:NX_RUN_JOURNAL = 'C:\Program Files\Siemens\NX1855\NXBIN\run_journal.exe'
py -3 backend/server.py
```

Adjust the path to your actual NX installation. The launcher also looks for NX using standard Siemens environment variables and common Windows installation folders.

## Viewer controls

| Action | Control |
| --- | --- |
| Rotate | Left mouse drag |
| Pan | Right mouse drag, or Shift + left drag |
| Zoom | Mouse wheel |
| Fit | **FIT**, **F**, or double-click |
| Camera views | **ISO / FRONT / TOP / RIGHT**, or keys **1–4** |
| Grid | **GRID** or **G** |
| Axes | **AXES** |
| Wireframe | **WIRE** or **W** |

The display is Y-up; imported NX geometry is rotated from NX's Z-up coordinate convention.

## Supported scope

The NX-to-browser workflow displays **tessellated surfaces**, not editable CAD solids or exact NX B-rep geometry. Both standalone parts and assembly occurrences are considered by the exporter, but a model that contains missing or unloaded component geometry will report an error rather than silently show incorrectly positioned components. Individual assembly tree controls are not available yet.

The browser currently accepts up to **1,000,000 STL triangles** or **256 MB** of STL data. Siemens NX `.jt` and `.chr` files are not supported in this release.
