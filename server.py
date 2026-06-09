import asyncio
import math
import struct
import socket
import threading
import time
import os
import json
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
import uvicorn

# === CONFIGURATION ===
# Set this to the SAME port you configured in FH6:
# Settings > HUD and Gameplay > Data Out IP Port
UDP_PORT = 20177
# Avoid ports 5200-5300 -- FH6 reserves them internally

# Directories and files
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")
GARAGE_FILE = os.path.join(os.path.dirname(__file__), "garage.json")
if not os.path.exists(LOGS_DIR):
    os.makedirs(LOGS_DIR)
if not os.path.exists(GARAGE_FILE):
    with open(GARAGE_FILE, "w", encoding="utf-8") as f:
        json.dump({}, f)

@asynccontextmanager
async def lifespan(app):
    thread = threading.Thread(target=udp_listener, daemon=True)
    thread.start()
    yield

app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory="public"), name="static")

@app.get("/")
def read_root():
    return RedirectResponse(url="/static/index.html")

# --- LOGS API ---
@app.post("/api/logs/save")
async def save_log(request: Request):
    try:
        data = await request.json()
        if not data or not isinstance(data, list) or len(data) == 0:
            return JSONResponse(status_code=400, content={"status": "error", "message": "Empty log"})
        
        # Load cars.json dictionary
        cars_db = {}
        cars_json_path = os.path.join(os.path.dirname(__file__), "cars.json")
        if os.path.exists(cars_json_path):
            with open(cars_json_path, "r", encoding="utf-8") as f:
                cars_db = json.load(f)

        # Extract info from first frame
        if isinstance(data, dict) and "log" in data:
            log_array = data["log"]
        else:
            log_array = data

        first_frame = log_array[0]
        car_ord = str(first_frame.get('car_ordinal', 0))
        car_class_int = first_frame.get('car_class', 0)
        car_pi = first_frame.get('car_pi', 0)
        dt_int = first_frame.get('drivetrain', 0)

        # Map values
        car_name = cars_db.get(car_ord, f"Unknown_Car_{car_ord}").replace(" ", "_").replace("/", "").replace("\\", "")
        class_map = {0: 'E', 1: 'D', 2: 'C', 3: 'B', 4: 'A', 5: 'S1', 6: 'S2', 7: 'X'}
        dt_map = {0: 'FWD', 1: 'RWD', 2: 'AWD'}
        
        car_class = class_map.get(car_class_int, "U")
        drivetrain = dt_map.get(dt_int, "UNK")

        # Generate filename: Nissan_Skyline_A800_AWD_20260609_120000.json
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{car_name}_{car_class}{car_pi}_{drivetrain}_{timestamp}.json"
        
        filepath = os.path.join(LOGS_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f)
            
        return {"status": "ok", "filename": filename}
    except Exception as e:
        print("Error saving log:", e)
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.get("/api/logs")
def list_logs():
    files = []
    if os.path.exists(LOGS_DIR):
        for f in os.listdir(LOGS_DIR):
            if f.endswith(".json"):
                files.append(f)
    files.sort(reverse=True) # newest first
    return {"logs": files}

@app.get("/api/logs/{filename}")
def get_log(filename: str):
    filepath = os.path.join(LOGS_DIR, filename)
    if not os.path.exists(filepath):
        return JSONResponse(status_code=404, content={"status": "error", "message": "Log not found"})
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data

@app.get("/api/garage")
def get_garage():
    try:
        with open(GARAGE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        return {}

@app.post("/api/garage")
async def save_garage(request: Request):
    try:
        data = await request.json()
        with open(GARAGE_FILE, "r", encoding="utf-8") as f:
            garage = json.load(f)
            
        car_ord = str(data.get("car_ordinal"))
        profile = data.get("profile")
        
        if not car_ord or not profile:
            return JSONResponse(status_code=400, content={"status": "error", "message": "Missing car_ordinal or profile"})
            
        if car_ord not in garage:
            garage[car_ord] = []
            
        # Update if profile with same name exists, else append
        updated = False
        for i, p in enumerate(garage[car_ord]):
            if p.get("name") == profile.get("name"):
                garage[car_ord][i] = profile
                updated = True
                break
                
        if not updated:
            garage[car_ord].append(profile)
            
        with open(GARAGE_FILE, "w", encoding="utf-8") as f:
            json.dump(garage, f, indent=2)
            
        return {"status": "ok"}
    except Exception as e:
        print("Error saving garage:", e)
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})


def make_empty_telemetry():
    return {
        "connected": False,
        "is_race_on": False,

        # Engine
        "rpm": 0, "max_rpm": 8000, "idle_rpm": 0,
        "power": 0, "torque": 0, "boost": 0,

        # Motion
        "speed": 0, "gear": 0,
        "accel": 0, "brake": 0, "steer": 0,
        "clutch": 0, "handbrake": 0,

        # G-forces (in g units)
        "g_lat": 0, "g_lon": 0, "g_vert": 0,

        # Tires [FL, FR, RL, RR]
        "tire_temp": [0, 0, 0, 0],
        "tire_slip_ratio": [0, 0, 0, 0],
        "tire_slip_angle": [0, 0, 0, 0],
        "tire_combined_slip": [0, 0, 0, 0],

        # Suspension [FL, FR, RL, RR] normalized 0-1
        "susp_travel": [0, 0, 0, 0],
        # Wheel rotation speed [FL, FR, RL, RR] rad/s
        "wheel_speed": [0, 0, 0, 0],

        # Car Info
        "car_ordinal": 0,
        "car_class": 0,
        "car_pi": 0,
        "drivetrain": 0,
        "cylinders": 0,

        # Body orientation
        "yaw": 0, "pitch": 0, "roll": 0,
        "yaw_rate": 0,

        # Race info
        "lap": 0, "best_lap": 0, "last_lap": 0,
        "current_lap_time": 0, "race_position": 0,
        "distance": 0,
    }


latest_telemetry = make_empty_telemetry()


def f32(data, offset):
    """Read a little-endian float32."""
    return struct.unpack_from('<f', data, offset)[0]

def i32(data, offset):
    """Read a little-endian int32."""
    return struct.unpack_from('<i', data, offset)[0]

def u8(data, offset):
    """Read an unsigned byte."""
    return struct.unpack_from('<B', data, offset)[0]

def s8(data, offset):
    """Read a signed byte."""
    return struct.unpack_from('<b', data, offset)[0]

def u16(data, offset):
    """Read a little-endian uint16."""
    return struct.unpack_from('<H', data, offset)[0]

def r(val, n=1):
    """Round a float."""
    return round(val, n)

def f_to_c(f):
    """Convert Fahrenheit to Celsius."""
    return (f - 32) * 5.0 / 9.0


def udp_listener():
    global latest_telemetry
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('0.0.0.0', UDP_PORT))
    print(f"[OK] Listening for FH6 Telemetry on UDP port {UDP_PORT}", flush=True)
    print(f"     Make sure FH6 Data Out IP Port is set to: {UDP_PORT}", flush=True)
    print(f"     Make sure FH6 Data Out IP Address is: 127.0.0.1", flush=True)
    print(f"     Make sure Data Out is: ON", flush=True)
    print(f"     Waiting for packets...", flush=True)

    packets = 0
    start_time = time.time()

    # Set a timeout so we can print periodic "still waiting" messages
    sock.settimeout(10.0)

    while True:
        try:
            data, addr = sock.recvfrom(2048)
            packets += 1

            if packets == 1:
                print(f"[RECV] First packet received from {addr}! Size: {len(data)} bytes", flush=True)

            # FH6 sends 324-byte packets
            if len(data) < 324:
                if packets <= 3:
                    print(f"[WARN] Unexpected packet size: {len(data)} bytes (expected 324)", flush=True)
                continue

            # Check IsRaceOn (offset 0, S32) -- 0 means in menu/paused
            is_race_on = i32(data, 0)
            if not is_race_on:
                latest_telemetry["connected"] = True
                latest_telemetry["is_race_on"] = False
                continue

            # ===== SLED BLOCK (offsets 0-231) -- same as FH5 =====
            max_rpm     = f32(data, 8)
            idle_rpm    = f32(data, 12)
            rpm         = f32(data, 16)

            # Acceleration (m/s^2) -- convert to G (divide by 9.81)
            accel_x = f32(data, 20) / 9.81   # lateral
            accel_y = f32(data, 24) / 9.81   # vertical
            accel_z = f32(data, 28) / 9.81   # longitudinal

            # Velocity (m/s)
            vel_x = f32(data, 32)
            vel_y = f32(data, 36)
            vel_z = f32(data, 40)

            # Angular velocity
            yaw_rate = f32(data, 48)         # around vertical axis

            # Body orientation (radians)
            yaw   = f32(data, 56)
            pitch = f32(data, 60)
            roll  = f32(data, 64)

            # Suspension travel (normalized 0-1)
            susp_fl = f32(data, 68)
            susp_fr = f32(data, 72)
            susp_rl = f32(data, 76)
            susp_rr = f32(data, 80)

            # Tire slip ratio (longitudinal)
            slip_ratio_fl = f32(data, 84)
            slip_ratio_fr = f32(data, 88)
            slip_ratio_rl = f32(data, 92)
            slip_ratio_rr = f32(data, 96)

            # Wheel rotation speed (rad/s)
            wheel_fl = f32(data, 100)
            wheel_fr = f32(data, 104)
            wheel_rl = f32(data, 108)
            wheel_rr = f32(data, 112)

            # Tire slip angle (radians)
            slip_angle_fl = f32(data, 164)
            slip_angle_fr = f32(data, 168)
            slip_angle_rl = f32(data, 172)
            slip_angle_rr = f32(data, 176)

            # Tire combined slip
            combined_fl = f32(data, 180)
            combined_fr = f32(data, 184)
            combined_rl = f32(data, 188)
            combined_rr = f32(data, 192)

            # Car properties
            car_ordinal = i32(data, 212)
            car_class   = i32(data, 216)
            car_pi      = i32(data, 220)
            drivetrain  = i32(data, 224)  # 0=FWD, 1=RWD, 2=AWD
            cylinders   = i32(data, 228)

            # ===== DASH BLOCK (offsets 232+) -- FH6 shifts +12 vs FH5 =====
            speed_mps   = f32(data, 256)    # Speed (m/s)     [FH5: 244]
            power_w     = f32(data, 260)    # Power (watts)   [FH5: 248]
            torque_nm   = f32(data, 264)    # Torque (Nm)     [FH5: 252]

            # Tire temps (Fahrenheit in packet -> convert to Celsius)
            tire_temp_fl = f_to_c(f32(data, 268))   # [FH5: 256]
            tire_temp_fr = f_to_c(f32(data, 272))   # [FH5: 260]
            tire_temp_rl = f_to_c(f32(data, 276))   # [FH5: 264]
            tire_temp_rr = f_to_c(f32(data, 280))   # [FH5: 268]

            boost       = f32(data, 284)    # [FH5: 272]
            fuel        = f32(data, 288)    # [FH5: 276]
            distance    = f32(data, 292)    # [FH5: 280]

            best_lap    = f32(data, 296)    # [FH5: 284]
            last_lap    = f32(data, 300)    # [FH5: 288]
            current_lap = f32(data, 304)    # [FH5: 292]
            race_time   = f32(data, 308)    # [FH5: 296]

            lap_number    = u16(data, 312)  # [FH5: 300]
            race_position = u8(data, 314)   # [FH5: 302]

            accel_input   = u8(data, 315)   # 0-255 [FH5: 303]
            brake_input   = u8(data, 316)   # 0-255 [FH5: 304]
            clutch_input  = u8(data, 317)   # 0-255 [FH5: 305]
            handbrake_in  = u8(data, 318)   # 0-255 [FH5: 306]
            gear          = u8(data, 319)   #       [FH5: 307]
            steer_input   = s8(data, 320)   # -128~127 [FH5: 308]

            speed_kph = speed_mps * 3.6

            latest_telemetry = {
                "connected": True,
                "is_race_on": True,

                # Engine
                "rpm": r(rpm),
                "max_rpm": r(max_rpm) if max_rpm > 0 else 8000.0,
                "idle_rpm": r(idle_rpm),
                "power": r(power_w / 745.7),         # watts -> HP
                "torque": r(torque_nm),
                "boost": r(boost, 2),

                # Motion
                "speed": r(speed_kph),
                "gear": gear,
                "accel": r((accel_input / 255.0) * 100),
                "brake": r((brake_input / 255.0) * 100),
                "steer": r((steer_input / 127.0) * 100),
                "clutch": r((clutch_input / 255.0) * 100),
                "handbrake": r((handbrake_in / 255.0) * 100),

                # G-forces
                "g_lat": r(accel_x, 2),
                "g_lon": r(accel_z, 2),
                "g_vert": r(accel_y, 2),

                # Tires [FL, FR, RL, RR]
                "tire_temp": [r(tire_temp_fl), r(tire_temp_fr), r(tire_temp_rl), r(tire_temp_rr)],
                "tire_slip_ratio": [r(slip_ratio_fl,3), r(slip_ratio_fr,3), r(slip_ratio_rl,3), r(slip_ratio_rr,3)],
                "tire_slip_angle": [r(slip_angle_fl,3), r(slip_angle_fr,3), r(slip_angle_rl,3), r(slip_angle_rr,3)],
                "tire_combined_slip": [r(combined_fl,3), r(combined_fr,3), r(combined_rl,3), r(combined_rr,3)],

                # Suspension [FL, FR, RL, RR]
                "susp_travel": [r(susp_fl,3), r(susp_fr,3), r(susp_rl,3), r(susp_rr,3)],
                "wheel_speed": [r(wheel_fl,1), r(wheel_fr,1), r(wheel_rl,1), r(wheel_rr,1)],


                # Car info
                "car_ordinal": car_ordinal,
                "car_class": car_class,
                "car_pi": car_pi,
                "drivetrain": drivetrain,
                "cylinders": cylinders,

                # Race
                "lap": lap_number,
                "best_lap": r(best_lap, 3),
                "last_lap": r(last_lap, 3),
                "current_lap_time": r(current_lap, 3),
                "race_position": race_position,
                "distance": r(distance),
            }

            if packets % 600 == 0:
                t = latest_telemetry
                print(f"[DATA] [{packets} pkts] "
                      f"RPM:{t['rpm']} Speed:{t['speed']}km/h Gear:{gear} "
                      f"Tires:{t['tire_temp']} Susp:{t['susp_travel']}", flush=True)

        except socket.timeout:
            elapsed = int(time.time() - start_time)
            print(f"[WARN] No packets received ({elapsed}s elapsed, {packets} total). Check:", flush=True)
            print(f"       1. FH6 Data Out = ON, Port = {UDP_PORT}, IP = 127.0.0.1", flush=True)
            print(f"       2. You are driving (not in menu/paused)", flush=True)
            print(f"       3. Firewall allows UDP on port {UDP_PORT}", flush=True)
            print(f"       4. If MS Store/Xbox version: run fix_loopback.ps1 as Admin", flush=True)
        except Exception as e:
            print(f"[ERR] Error parsing packet: {e}", flush=True)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(latest_telemetry)
            await asyncio.sleep(0.016) # ~60Hz update rate
    except:
        pass

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000)
