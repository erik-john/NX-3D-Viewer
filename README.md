# NX 3D Viewer

A local, browser-based 3D viewer for Siemens NX models. The application will use a Python backend and a web frontend, with NX integration added in a later milestone.

## Project scope

The project is being built in small, independently usable milestones:

1. Establish the project structure.
2. Implement a standalone 3D viewer.
3. Add Siemens NX file loading and visualization.
4. Extend the viewer with assembly navigation and visualization tools.

## Planned project structure

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

Directories and application files will be added as their corresponding capabilities are implemented.

## Running the application

Once the application is available, start it on Windows using `Run.bat` and open:

**http://127.0.0.1:8888/**

Port **8888** is the fixed application port.

## Current status

The repository has been initialized. The standalone viewer and NX integration will be added in subsequent milestones.
