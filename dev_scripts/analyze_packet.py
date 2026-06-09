"""
FH6 Packet Structure Analyzer
Captures 10 packets while driving and dumps all float/int values
to identify correct offsets for speed, RPM, gear, etc.
"""
import socket
import struct
import time

UDP_PORT = 20177

# Known FH5 "Car Dash" 324-byte packet layout for reference:
# We'll check if FH6 matches or differs.
FH5_FIELDS = {
    0: ("IsRaceOn", "i"),
    4: ("TimestampMS", "I"),
    8: ("EngineMaxRpm", "f"),
    12: ("EngineIdleRpm", "f"),
    16: ("CurrentEngineRpm", "f"),
    20: ("AccelerationX", "f"),
    24: ("AccelerationY", "f"),
    28: ("AccelerationZ", "f"),
    32: ("VelocityX", "f"),
    36: ("VelocityY", "f"),
    40: ("VelocityZ", "f"),
    44: ("AngularVelocityX", "f"),
    48: ("AngularVelocityY", "f"),
    52: ("AngularVelocityZ", "f"),
    56: ("Yaw", "f"),
    60: ("Pitch", "f"),
    64: ("Roll", "f"),
    68: ("NormSuspensionTravelFL", "f"),
    72: ("NormSuspensionTravelFR", "f"),
    76: ("NormSuspensionTravelRL", "f"),
    80: ("NormSuspensionTravelRR", "f"),
    84: ("TireSlipRatioFL", "f"),
    88: ("TireSlipRatioFR", "f"),
    92: ("TireSlipRatioRL", "f"),
    96: ("TireSlipRatioRR", "f"),
    100: ("WheelRotationSpeedFL", "f"),
    104: ("WheelRotationSpeedFR", "f"),
    108: ("WheelRotationSpeedRL", "f"),
    112: ("WheelRotationSpeedRR", "f"),
    116: ("WheelOnRumbleStripFL", "i"),
    120: ("WheelOnRumbleStripFR", "i"),
    124: ("WheelOnRumbleStripRL", "i"),
    128: ("WheelOnRumbleStripRR", "i"),
    132: ("WheelInPuddleDepthFL", "f"),
    136: ("WheelInPuddleDepthFR", "f"),
    140: ("WheelInPuddleDepthRL", "f"),
    144: ("WheelInPuddleDepthRR", "f"),
    148: ("SurfaceRumbleFL", "f"),
    152: ("SurfaceRumbleFR", "f"),
    156: ("SurfaceRumbleRL", "f"),
    160: ("SurfaceRumbleRR", "f"),
    164: ("TireSlipAngleFL", "f"),
    168: ("TireSlipAngleFR", "f"),
    172: ("TireSlipAngleRL", "f"),
    176: ("TireSlipAngleRR", "f"),
    180: ("TireCombinedSlipFL", "f"),
    184: ("TireCombinedSlipFR", "f"),
    188: ("TireCombinedSlipRL", "f"),
    192: ("TireCombinedSlipRR", "f"),
    196: ("SuspensionTravelMetersFL", "f"),
    200: ("SuspensionTravelMetersFR", "f"),
    204: ("SuspensionTravelMetersRL", "f"),
    208: ("SuspensionTravelMetersRR", "f"),
    212: ("CarOrdinal", "i"),
    216: ("CarClass", "i"),
    220: ("CarPerformanceIndex", "i"),
    224: ("DrivetrainType", "i"),
    228: ("NumCylinders", "i"),
    # Dash block starts at 232 in FH5
    232: ("PositionX", "f"),
    236: ("PositionY", "f"),
    240: ("PositionZ", "f"),
    244: ("Speed_mps", "f"),
    248: ("Power_watts", "f"),
    252: ("Torque_Nm", "f"),
    256: ("TireTempFL", "f"),
    260: ("TireTempFR", "f"),
    264: ("TireTempRL", "f"),
    268: ("TireTempRR", "f"),
    272: ("Boost", "f"),
    276: ("Fuel", "f"),
    280: ("DistanceTraveled", "f"),
    284: ("BestLap", "f"),
    288: ("LastLap", "f"),
    292: ("CurrentLap", "f"),
    296: ("CurrentRaceTime", "f"),
    300: ("LapNumber", "H"),
    302: ("RacePosition", "B"),
    303: ("Accel_u8", "B"),
    304: ("Brake_u8", "B"),
    305: ("Clutch_u8", "B"),
    306: ("Handbrake_u8", "B"),
    307: ("Gear_u8", "B"),
    308: ("Steer_s8", "b"),
    309: ("NormDrivingLine", "b"),
    310: ("NormAIBrakeDiff", "b"),
    # Possible extra fields in FH6?
}

def analyze():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('0.0.0.0', UDP_PORT))
    sock.settimeout(30.0)
    
    print("=" * 70)
    print("FH6 PACKET ANALYZER")
    print("=" * 70)
    print(f"Listening on UDP port {UDP_PORT}...")
    print("Drive around in FH6! Will capture 10 packets with IsRaceOn=1.")
    print("")

    captured = []
    total = 0
    
    while len(captured) < 10:
        try:
            data, addr = sock.recvfrom(4096)
            total += 1
            
            if total == 1:
                print(f"Packet size: {len(data)} bytes (FH5 = 324 bytes)")
                print("")
            
            if len(data) < 232:
                continue
                
            is_race = struct.unpack_from('<i', data, 0)[0]
            if is_race == 1:
                captured.append(data)
                if len(captured) == 1:
                    print(f"First active packet captured (after {total} total packets)")
        except socket.timeout:
            print("Timeout - no packets received!")
            return
    
    sock.close()
    
    print(f"\nCaptured {len(captured)} active packets. Analyzing...\n")
    
    # === ANALYSIS 1: FH5 layout check ===
    print("=" * 70)
    print("ANALYSIS 1: FH5 FIELD LAYOUT (checking if FH6 matches)")
    print("=" * 70)
    
    pkt = captured[0]
    
    for offset in sorted(FH5_FIELDS.keys()):
        name, fmt = FH5_FIELDS[offset]
        try:
            val = struct.unpack_from(f'<{fmt}', pkt, offset)[0]
            # Highlight suspicious values
            flag = ""
            if name == "Speed_mps" and (val < 0 or val > 200):
                flag = " *** SUSPICIOUS (expected 0-200 m/s) ***"
            elif name == "CurrentEngineRpm" and (val < 0 or val > 20000):
                flag = " *** SUSPICIOUS ***"
            elif name == "Gear_u8" and (val < 0 or val > 10):
                flag = " *** SUSPICIOUS (expected 0-10) ***"
            print(f"  [{offset:3d}] {name:35s} = {val}{flag}")
        except:
            print(f"  [{offset:3d}] {name:35s} = ERROR")
    
    # === ANALYSIS 2: Find speed candidates ===
    print("")
    print("=" * 70)
    print("ANALYSIS 2: SPEED CANDIDATES (floats that look like m/s speed)")
    print("  Looking for values 0-100 m/s (0-360 km/h) across packets")
    print("=" * 70)
    
    for offset in range(0, len(pkt) - 3, 4):
        values = []
        for p in captured:
            val = struct.unpack_from('<f', p, offset)[0]
            values.append(val)
        
        # Speed should be 0-100 m/s, and should vary between packets
        avg = sum(values) / len(values)
        if 0.5 < avg < 120 and max(values) - min(values) < 50:
            kph = avg * 3.6
            name = FH5_FIELDS.get(offset, ("???",))[0]
            print(f"  [{offset:3d}] avg={avg:8.2f} m/s ({kph:6.1f} km/h)  "
                  f"range=[{min(values):.2f}, {max(values):.2f}]  "
                  f"FH5_name={name}")
    
    # === ANALYSIS 3: Find RPM candidates ===
    print("")
    print("=" * 70)
    print("ANALYSIS 3: RPM CANDIDATES (floats 500-15000)")
    print("=" * 70)
    
    for offset in range(0, len(pkt) - 3, 4):
        values = []
        for p in captured:
            val = struct.unpack_from('<f', p, offset)[0]
            values.append(val)
        
        avg = sum(values) / len(values)
        if 500 < avg < 15000 and max(values) > 600:
            name = FH5_FIELDS.get(offset, ("???",))[0]
            print(f"  [{offset:3d}] avg={avg:8.1f}  "
                  f"range=[{min(values):.1f}, {max(values):.1f}]  "
                  f"FH5_name={name}")
    
    # === ANALYSIS 4: Gear candidates (bytes) ===
    print("")
    print("=" * 70)
    print("ANALYSIS 4: GEAR CANDIDATES (bytes 0-10)")
    print("=" * 70)
    
    for offset in range(0, len(pkt)):
        values = []
        for p in captured:
            val = struct.unpack_from('<B', p, offset)[0]
            values.append(val)
        
        avg = sum(values) / len(values)
        if 0 < avg < 10 and all(0 <= v <= 10 for v in values):
            name = FH5_FIELDS.get(offset, ("???",))[0]
            vals_str = ",".join(str(v) for v in values)
            print(f"  [{offset:3d}] values=[{vals_str}]  FH5_name={name}")
    
    # === ANALYSIS 5: Raw hex dump of first packet ===
    print("")
    print("=" * 70)
    print("ANALYSIS 5: FULL FLOAT DUMP (every 4 bytes)")
    print("=" * 70)
    
    for offset in range(0, len(pkt) - 3, 4):
        val_f = struct.unpack_from('<f', pkt, offset)[0]
        val_i = struct.unpack_from('<i', pkt, offset)[0]
        raw = pkt[offset:offset+4].hex()
        name = FH5_FIELDS.get(offset, ("",))[0]
        print(f"  [{offset:3d}] float={val_f:15.4f}  int={val_i:12d}  hex={raw}  {name}")
    
    # Last bytes (311-323) as individual bytes
    print("")
    print("TAIL BYTES (offset 300+):")
    for offset in range(300, len(pkt)):
        val_u = struct.unpack_from('<B', pkt, offset)[0]
        val_s = struct.unpack_from('<b', pkt, offset)[0]
        name = FH5_FIELDS.get(offset, ("",))[0]
        print(f"  [{offset:3d}] unsigned={val_u:3d}  signed={val_s:4d}  {name}")
    
    print("")
    print("=" * 70)
    print("DONE")
    print("=" * 70)


if __name__ == "__main__":
    analyze()
