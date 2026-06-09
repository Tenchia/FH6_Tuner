import asyncio
import struct
import socket
import threading
import time
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
import uvicorn

# === CONFIGURATION ===
# Set this to the SAME port you configured in FH6:
# Settings → HUD and Gameplay → Data Out IP Port
UDP_PORT = 20127
# Avoid ports 5200-5300 — FH6 reserves them internally

app = FastAPI()

app.mount("/static", StaticFiles(directory="public"), name="static")

@app.get("/")
def read_root():
    return RedirectResponse(url="/static/index.html")

latest_telemetry = {
    "connected": False,
    "rpm": 0.0,
    "max_rpm": 8000.0,
    "speed": 0.0,
    "accel": 0.0,
    "brake": 0.0,
    "gear": 0,
    "steer": 0.0
}

def udp_listener():
    global latest_telemetry
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('0.0.0.0', UDP_PORT))
    print(f"✅ Listening for FH6 Telemetry on UDP port {UDP_PORT}", flush=True)
    print(f"   Make sure FH6 Data Out IP Port is set to: {UDP_PORT}", flush=True)
    print(f"   Make sure FH6 Data Out IP Address is: 127.0.0.1", flush=True)
    print(f"   Make sure Data Out is: ON", flush=True)
    print(f"   ⏳ Waiting for packets...", flush=True)
    
    packets = 0
    start_time = time.time()
    last_warning_time = 0
    
    # Set a timeout so we can print periodic "still waiting" messages
    sock.settimeout(10.0)
    
    while True:
        try:
            data, addr = sock.recvfrom(2048)
            packets += 1
            
            if packets == 1:
                print(f"🎉 First packet received from {addr}! Size: {len(data)} bytes", flush=True)
            
            # FH6 sends 324-byte packets
            if len(data) < 324:
                if packets <= 3:
                    print(f"⚠️  Unexpected packet size: {len(data)} bytes (expected 324)", flush=True)
                continue
            
            # Check IsRaceOn (offset 0, S32) — 0 means in menu/paused
            is_race_on = struct.unpack_from('<i', data, 0)[0]
            if not is_race_on:
                # Still update connection status but skip data parsing
                latest_telemetry["connected"] = True
                continue
            
            # --- Correct offsets for 324-byte FH6 "Car Dash" packet ---
            # Engine data (Sled block, offsets 0-231)
            rpm = struct.unpack_from('<f', data, 16)[0]        # CurrentEngineRpm
            max_rpm = struct.unpack_from('<f', data, 8)[0]     # EngineMaxRpm
            
            # Car Dash block (offsets 232+)
            speed_mps = struct.unpack_from('<f', data, 244)[0] # Speed (m/s)
            accel = struct.unpack_from('<B', data, 315)[0]     # Accel (0-255)
            brake = struct.unpack_from('<B', data, 316)[0]     # Brake (0-255)
            gear = struct.unpack_from('<B', data, 319)[0]      # Gear
            steer = struct.unpack_from('<b', data, 320)[0]     # Steer (-128 to 127)
            
            speed_kph = speed_mps * 3.6
            
            latest_telemetry = {
                "connected": True,
                "rpm": round(rpm, 1),
                "max_rpm": round(max_rpm, 1) if max_rpm > 0 else 8000.0,
                "speed": round(speed_kph, 1),
                "accel": round((accel / 255.0) * 100, 1),
                "brake": round((brake / 255.0) * 100, 1),
                "gear": gear,
                "steer": round((steer / 127.0) * 100, 1)
            }
            
            if packets % 120 == 0:
                print(f"📊 [{packets} pkts] RPM:{latest_telemetry['rpm']} Speed:{latest_telemetry['speed']}km/h Gear:{gear}", flush=True)
                
        except socket.timeout:
            # No packets received for 10 seconds — print diagnostic
            elapsed = int(time.time() - start_time)
            print(f"⚠️  No packets received ({elapsed}s elapsed, {packets} total). Check:", flush=True)
            print(f"   1. FH6 Data Out = ON, Port = {UDP_PORT}, IP = 127.0.0.1", flush=True)
            print(f"   2. You are driving (not in menu/paused)", flush=True)
            print(f"   3. Firewall allows UDP on port {UDP_PORT}", flush=True)
            print(f"   4. If MS Store/Xbox version: run fix_loopback.ps1 as Admin", flush=True)
        except Exception as e:
            print(f"❌ Error parsing packet: {e}", flush=True)

@app.on_event("startup")
async def startup_event():
    thread = threading.Thread(target=udp_listener, daemon=True)
    thread.start()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(latest_telemetry)
            await asyncio.sleep(0.033) # ~30Hz update rate
    except:
        pass

if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000)
