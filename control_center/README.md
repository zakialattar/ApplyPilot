# ApplyPilot Control Center

This folder contains a simple local web UI for running the real ApplyPilot repo in the sibling folder:

- the ApplyPilot repo root
- `launch_applypilot_ui.command`
- `launch_applypilot_ui.ps1`
- `launch_applypilot_ui.bat`

## Easiest way to open it

On macOS, double-click:

- `launch_applypilot_ui.command`

On Windows, double-click:

- `launch_applypilot_ui.bat`

These launchers:

1. Builds the UI
2. Starts the local control-center server on `http://127.0.0.1:8787`
3. Opens the browser automatically

## What the UI does

- Saves `~/.applypilot/profile.json`
- Saves `~/.applypilot/searches.yaml`
- Saves `~/.applypilot/.env`
- Stores resume files in `~/.applypilot/`
- Installs or repairs the Python environment for ApplyPilot
- Runs `applypilot doctor`, `status`, `run`, `dashboard`, and `apply`
- Streams live command logs into the page

## Dev commands

```bash
cd control_center
npm install
npm run build
npm run start
```
