# FH6 Tuner — Forza Horizon 6 Telemetry Dashboard

Real-time telemetry dashboard for Forza Horizon 6 that displays vehicle data (speed, RPM, gear, pedals, steering) in a browser via WebSocket.

## Requirements

- Python 3.10+
- Forza Horizon 6 with Data Out enabled

## Quick Start

```bash
# 1. Create virtual environment
python -m venv venv

# 2. Activate it
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# Windows CMD:
.\venv\Scripts\activate.bat

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the server
python server.py
```

Open **http://127.0.0.1:8000** in your browser.

## FH6 Settings

In-game: **Settings → HUD and Gameplay → Data Out**

| Setting | Value |
|---------|-------|
| Data Out | **ON** |
| Data Out IP Address | **127.0.0.1** |
| Data Out IP Port | **20127** |

> ⚠️ Avoid ports 5200–5300 — FH6 reserves them internally.

## MS Store / Xbox App Version

If you installed FH6 from the Microsoft Store or Xbox App, you need to enable loopback access. Run the included script **as Administrator**:

```powershell
.\fix_loopback.ps1
```

This is **not needed** for the Steam version.

## Troubleshooting

- **No data?** Make sure you're actively driving (not in menu/paused).
- **Check the console** — the server prints diagnostic messages every 10 seconds if no packets arrive.
- **Firewall** — allow UDP traffic on port 20127.
