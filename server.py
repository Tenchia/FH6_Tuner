import asyncio
import struct
import socket
import threading
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
import uvicorn

app = FastAPI()

app.mount("/static", StaticFiles(directory="public"), name="static")

@app.get("/")
def read_root():
    return RedirectResponse(url="/static/index.html")

latest_telemetry = {
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
    sock.bind(('0.0.0.0', 20777))
    print("Listening for Forza Telemetry on UDP 20777", flush=True)
    
    packets = 0
    while True:
        try:
            data, addr = sock.recvfrom(1024)
            packets += 1
            if packets == 1:
                print(f"DEBUG: First packet received! Size: {len(data)}", flush=True)
                
            if len(data) >= 232:
                rpm = struct.unpack_from('<f', data, 16)[0]
                max_rpm = struct.unpack_from('<f', data, 8)[0]
                
                if len(data) >= 324:
                    speed_mps = struct.unpack_from('<f', data, 212)[0]
                    accel = struct.unpack_from('<B', data, 271)[0]
                    brake = struct.unpack_from('<B', data, 272)[0]
                    gear = struct.unpack_from('<B', data, 275)[0]
                    steer = struct.unpack_from('<b', data, 276)[0]
                else:
                    vx = struct.unpack_from('<f', data, 32)[0]
                    vy = struct.unpack_from('<f', data, 36)[0]
                    vz = struct.unpack_from('<f', data, 40)[0]
                    speed_mps = (vx**2 + vy**2 + vz**2) ** 0.5
                    accel = 0
                    brake = 0
                    gear = 0
                    steer = 0
                
                speed_kph = speed_mps * 3.6
                
                latest_telemetry = {
                    "rpm": round(rpm, 1),
                    "max_rpm": round(max_rpm, 1) if max_rpm > 0 else 8000.0,
                    "speed": round(speed_kph, 1),
                    "accel": round((accel / 255.0) * 100, 1),
                    "brake": round((brake / 255.0) * 100, 1),
                    "gear": gear,
                    "steer": round((steer / 127.0) * 100, 1)
                }
                
                if packets % 60 == 0:
                    print(f"DEBUG: Parsed data: {latest_telemetry}", flush=True)
        except Exception as e:
            print(f"DEBUG Error parsing: {e}", flush=True)

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
