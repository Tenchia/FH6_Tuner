# FH6 Tuner — Professional Telemetry Dashboard

A real-time, browser-based telemetry dashboard and tuning advisor for **Forza Horizon 6**. It captures UDP telemetry directly from the game and provides live data visualization, smart tuning recommendations, and a garage management system.

## 🌟 Key Features

1. **Live Dashboard**: High-performance layout displaying speed, gear, RPM, horizontal pedal inputs, tire temps, suspension travel, G-forces, and car balance in real-time.
2. **Garage & Setup**: 
   - A clean UI to input car base specifications (weight, springs, aero).
   - Generates and calculates base tunes instantly.
   - Saves your car setups persistently in your `data/` folder.
3. **Telemetry & Advisor**: 
   - Record and analyze driving sessions.
   - Detects bottoming out, understeer/oversteer, bad shift points, and excessive wheel spin.
   - Automatically suggests precise tuning adjustments (e.g. "Stiffen Rear Springs by 10%").

## 📁 Project Structure

- `server.py`: The main Python backend (UDP listener & WebSocket server).
- `public/`: The frontend UI (HTML, CSS, JS) with a premium glassmorphism design.
- `data/`: Local storage for `cars.json` (car DB) and `garage.json` (your saved setups).
- `dev_scripts/`: Utility scripts for reverse-engineering and fetching car data.
- `logs/`: Recorded telemetry sessions.

## 🚀 Quick Start

1. **Install Python 3.10+**.
2. **Create and activate a virtual environment**:
   ```bash
   python -m venv venv
   # Windows PowerShell:
   .\venv\Scripts\Activate.ps1
   ```
3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
4. **Run the server**:
   ```bash
   python server.py
   ```
5. **Open** `http://127.0.0.1:8000` in your web browser.

## 🎮 FH6 In-Game Settings

Go to **Settings → HUD and Gameplay → Data Out** and set:
- **Data Out**: ON
- **Data Out IP Address**: 127.0.0.1
- **Data Out IP Port**: 20177

*(Note: Avoid ports 5200–5300 as FH6 reserves them internally)*

## ⚠️ Microsoft Store / Xbox App Version

If you installed FH6 from the MS Store or Xbox App, UWP security blocks local loopback connections. 
You **must** run the included script as Administrator to allow FH6 to send data to your local server:

```powershell
.\fix_loopback.ps1
```
*(This step is NOT needed if you play on Steam).*

## 🛠️ Troubleshooting

- **No data in the browser?** 
  - Ensure you are actually driving (telemetry pauses in menus).
  - Check the server console for warnings.
  - Verify your Windows Firewall isn't blocking UDP port 20177.
