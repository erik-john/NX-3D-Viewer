# NX 3D Viewer

A local, browser-based 3D viewer for Siemens NX models. The application uses a Python backend and a web frontend, with NX integration planned for a later milestone.

## Project scope

The project is built in small, independently usable milestones:

1. Establish the project structure.
2. Implement a standalone 3D viewer.
3. Add Siemens NX file loading and visualization.
4. Extend the viewer with assembly navigation and visualization tools.

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
│       └── app.js
├── nx/
├── Run.bat
├── .gitignore
├── README.md
└── VERSION.txt
```

The `backend/` folder serves the local application. The `frontend/` folder contains the browser interface. The `nx/` folder is reserved for Siemens NX integration.

## Requirements

- Windows 10/11 or Windows Server
- Python 3.10 or newer
- A modern web browser

No additional Python packages are required for the current application skeleton.

## Running the application

1. Open the repository folder in Windows.
2. Double-click `Run.bat`, or run `py -3 backend/server.py` in a terminal.
3. Open **http://127.0.0.1:8888/** in a browser.
4. Stop the server using **Ctrl+C** in its terminal.

The server listens on `127.0.0.1` and uses fixed port **8888**.

## Current status

The project structure and basic local web server are in place. The 3D rendering workspace and Siemens NX file loading will be implemented in later milestones.
