# NX 3D Viewer

A local, browser-based 3D visualization application designed for Siemens NX integration. It uses a Python HTTP server and an interactive WebGL frontend. The viewer currently displays built-in sample geometry; Siemens NX file loading will be added in a later milestone.

## Features

- Interactive 3D display with solid surfaces and wireframe rendering.
- Mechanical assembly, block, sphere, and cylinder sample scenes.
- Mouse rotation, panning, and zooming.
- Isometric, front, top, and right camera views, plus fit-to-view.
- Optional reference grid and X/Y/Z axes.
- Scene information including object and triangle counts.
- Runs on the local computer without a cloud service or JavaScript CDN.

## Project structure

```text
NX-3D-Viewer/
├── backend/
│   └── server.py
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       ├── geometry.js
│       └── viewer.js
├── nx/
├── Run.bat
├── .gitignore
├── README.md
└── VERSION.txt
```

- `backend/server.py` serves the interface on the local machine.
- `frontend/` contains the page, styling, geometry generators, and WebGL renderer.
- `nx/` is reserved for the Siemens NX integration.

## Requirements

- Windows 10/11 or Windows Server
- Python 3.10 or newer
- A current browser with WebGL support and available graphics acceleration

The current viewer requires no additional Python packages, Node.js installation, or internet access.

## Run

1. Open the repository folder.
2. Double-click **`Run.bat`**. Alternatively, execute `py -3 backend/server.py` from the repository root.
3. Visit **http://127.0.0.1:8888/** in a browser.
4. Press **Ctrl+C** in the terminal to stop the server.

The application listens on `127.0.0.1`, using fixed port **8888**. If another application is already using that port, stop the other application first.

## Viewer controls

| Action | Control |
| --- | --- |
| Rotate | Drag with left mouse button |
| Pan | Drag with right mouse button, or Shift + left drag |
| Zoom | Scroll the mouse wheel |
| Fit scene | **FIT** or **F** |
| Camera direction | **ISO**, **FRONT**, **TOP**, **RIGHT** or keys **1–4** |
| Reference grid | **GRID** or **G** |
| Axis display | **AXES** |
| Wireframe | **WIRE** or **W** |
| Sample scene | Choose a scene from the **SCENE** menu |

Coordinate convention: **Y is up**, and the grid lies in the X/Z plane.

## Current scope

The viewer uses procedurally generated sample geometry. It does not yet load Siemens NX `.prt` files, STL files, assemblies, or manufacturing data. A Siemens NX installation is not required for this milestone.
