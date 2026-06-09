// ===== FH6 TUNING CALCULATOR - app.js =====

// --- DOM References ---
const $ = id => document.getElementById(id);

// --- State ---
let ws;
const HISTORY_SIZE = 600; // ~5 seconds at 120Hz
const history = {
    tireTemp: [[],[],[],[]], // FL,FR,RL,RR
    slipAngleFront: [],
    slipAngleRear: [],
    gearData: {},        // { gear: [{rpm, speed, power}] }
    powerCurve: [],      // [{rpm, power}]
    advisor: {
        suspSamples: [[],[],[],[]], // normalized travel values
        slipAngleSamples: { front:[], rear:[] },
        wheelSpeedSamples: [[],[],[],[]],
        brakeLockSamples: [[],[],[],[]],
        tempSamples: [[],[],[],[]],
        count: 0,
    }
};

// --- Tab Navigation ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        $('tab-' + btn.dataset.tab).classList.add('active');
    });
});

// --- WebSocket Connection ---
let garageData = {};
let currentCarOrdinal = null;

fetch('/api/garage').then(r => r.json()).then(data => {
    garageData = data;
    if (currentCarOrdinal) {
        onCarChanged(currentCarOrdinal);
    }
}).catch(console.error);

function onCarChanged(newOrd) {
    currentCarOrdinal = newOrd;
    const select = $('garage-profile-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Profile --</option>';
    if (garageData[newOrd] && garageData[newOrd].length > 0) {
        garageData[newOrd].forEach((profile, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = profile.name;
            select.appendChild(opt);
        });
    } else {
        select.innerHTML = '<option value="">No setups found for this car</option>';
    }
}

function connect() {
    ws = new WebSocket(`ws://${window.location.host}/ws`);
    ws.onopen = () => {
        $('status-text').textContent = 'Waiting for FH6...';
        $('status').classList.add('connected');
        $('status').classList.remove('receiving');
    };
    ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.is_race_on && (d.rpm > 0 || d.speed > 0)) {
            $('status-text').textContent = 'Receiving Telemetry';
            $('status').classList.add('receiving');
        } else if (d.connected) {
            $('status-text').textContent = 'FH6 Connected (Menu)';
            $('status').classList.add('connected');
            $('status').classList.remove('receiving');
        }
        update(d);
    };
    ws.onclose = () => {
        $('status-text').textContent = 'Reconnecting...';
        $('status').classList.remove('connected','receiving');
        setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
}

// --- Main Update ---
let latestData = null;

function update(d) {
    if (d.car_ordinal && d.car_ordinal > 0 && d.car_ordinal !== currentCarOrdinal) {
        onCarChanged(d.car_ordinal);
    }
    latestData = d;
    recordHistory(d);
    recordSessionFrame(d);
}

// Render loop synced to monitor refresh rate
function renderLoop() {
    if (latestData) {
        updateLive(latestData);
        latestData = null;
    }
    requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// ===== LIVE TAB =====
const CAR_CLASSES = ['D','C','B','A','S1','S2','X'];
const DRIVE_TYPES = ['FWD','RWD','AWD'];

function updateLive(d) {
    // Speed / Gear / RPM
    $('speed-val').textContent = Math.floor(d.speed);
    $('gear-val').textContent = d.gear === 0 ? (d.speed > 1 ? 'R' : 'N') : d.gear;
    $('rpm-val').textContent = Math.floor(d.rpm);

    const rpmPct = Math.min(100, Math.max(0, (d.rpm / d.max_rpm) * 100));
    const rpmBar = $('rpm-bar');
    rpmBar.style.width = rpmPct + '%';
    rpmBar.classList.toggle('redline', rpmPct > 90);

    // Pedals
    $('throttle-bar').style.width = d.accel + '%';
    $('throttle-val').textContent = Math.floor(d.accel) + '%';
    $('brake-bar').style.width = d.brake + '%';
    $('brake-val').textContent = Math.floor(d.brake) + '%';
    const steerPct = 50 + d.steer / 2;
    $('steer-dot').style.left = Math.max(5, Math.min(95, steerPct)) + '%';
    $('steer-val').textContent = Math.abs(Math.floor(d.steer)) + '% ' + (d.steer < -1 ? 'L' : d.steer > 1 ? 'R' : '');

    // Tire Temps
    const tireIds = ['tire-fl','tire-fr','tire-rl','tire-rr'];
    d.tire_temp.forEach((t, i) => {
        const el = $(tireIds[i]);
        el.textContent = Math.round(t) + '°';
        el.className = 'tire-cell ' + getTempClass(t);
    });

    // Suspension
    const suspIds = ['susp-fl','susp-fr','susp-rl','susp-rr'];
    d.susp_travel.forEach((v, i) => {
        const el = $(suspIds[i]);
        const pct = Math.max(0, Math.min(100, v * 100));
        el.style.height = pct + '%';
        el.className = 'susp-bar-fill' + (v > 0.85 ? ' danger' : v > 0.7 ? ' warn' : '');
    });

    // G-Meter
    drawGMeter(d.g_lat, d.g_lon);

    // Balance (understeer/oversteer)
    const frontSlip = (Math.abs(d.tire_slip_angle[0]) + Math.abs(d.tire_slip_angle[1])) / 2;
    const rearSlip = (Math.abs(d.tire_slip_angle[2]) + Math.abs(d.tire_slip_angle[3])) / 2;
    let balance = 50;
    if (frontSlip + rearSlip > 0.001) {
        balance = (frontSlip / (frontSlip + rearSlip)) * 100; // >50 = understeer
    }
    const balDot = $('balance-dot');
    balDot.style.left = Math.max(5, Math.min(95, balance)) + '%';
    balDot.style.background = balance > 60 ? 'var(--blue)' : balance < 40 ? 'var(--magenta)' : 'var(--green)';
    balDot.style.boxShadow = `0 0 10px ${balance > 60 ? 'var(--blue)' : balance < 40 ? 'var(--magenta)' : 'var(--green)'}`;

    // Info cards
    $('power-val').textContent = Math.floor(d.power);
    $('torque-val').textContent = Math.floor(d.torque);
    $('class-val').textContent = (CAR_CLASSES[d.car_class] || '?') + ' ' + d.car_pi;
    $('drive-val').textContent = DRIVE_TYPES[d.drivetrain] || '?';
}

function getTempClass(t) {
    if (t < 40) return 'tire-cold';
    if (t < 80) return 'tire-optimal';
    if (t < 100) return 'tire-warm';
    return 'tire-hot';
}

// --- G-Meter Canvas ---
function drawGMeter(lat, lon) {
    const c = $('g-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const cx = w/2, cy = h/2, r = w/2 - 12;

    ctx.clearRect(0, 0, w, h);

    // Circles
    [1, 0.5].forEach(mult => {
        ctx.beginPath();
        ctx.arc(cx, cy, r * mult, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();
    });

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.stroke();

    // Dot (clamp to circle)
    const maxG = 2.0;
    const dx = Math.max(-1, Math.min(1, lat / maxG)) * r;
    const dy = Math.max(-1, Math.min(1, -lon / maxG)) * r;

    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'var(--cyan)';
    const gMag = Math.sqrt(lat*lat + lon*lon);
    ctx.fillStyle = gMag > 1.5 ? '#ff1744' : gMag > 1.0 ? '#ffab00' : '#00e5ff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Update values
    $('g-lat-val').textContent = 'LAT ' + lat.toFixed(2) + 'g';
    $('g-lon-val').textContent = 'LON ' + lon.toFixed(2) + 'g';
}

// ===== HISTORY RECORDING =====
let frameCount = 0;
function recordHistory(d) {
    if (!d.is_race_on || d.speed < 1) return;
    frameCount++;
    if (frameCount % 4 !== 0) return; // Record at ~30Hz instead of 120Hz

    // Tire temp history
    for (let i = 0; i < 4; i++) {
        history.tireTemp[i].push(d.tire_temp[i]);
        if (history.tireTemp[i].length > HISTORY_SIZE) history.tireTemp[i].shift();
    }

    // Slip angle history
    const fSlip = (Math.abs(d.tire_slip_angle[0]) + Math.abs(d.tire_slip_angle[1])) / 2;
    const rSlip = (Math.abs(d.tire_slip_angle[2]) + Math.abs(d.tire_slip_angle[3])) / 2;
    history.slipAngleFront.push(fSlip);
    history.slipAngleRear.push(rSlip);
    if (history.slipAngleFront.length > HISTORY_SIZE) { history.slipAngleFront.shift(); history.slipAngleRear.shift(); }

    // Gear data (for scatter plot and shift points)
    if (d.gear > 0 && d.gear < 11) {
        if (!history.gearData[d.gear]) history.gearData[d.gear] = [];
        history.gearData[d.gear].push({ rpm: d.rpm, speed: d.speed, power: d.power });
        if (history.gearData[d.gear].length > 500) history.gearData[d.gear].shift();
    }

    // Power curve
    if (d.power > 5) {
        history.powerCurve.push({ rpm: d.rpm, power: d.power });
        if (history.powerCurve.length > 2000) history.powerCurve.shift();
    }

    // Advisor accumulation
    const adv = history.advisor;
    for (let i = 0; i < 4; i++) {
        adv.suspSamples[i].push(d.susp_travel[i]);
        adv.tempSamples[i].push(d.tire_temp[i]);
        adv.wheelSpeedSamples[i].push(d.wheel_speed[i]);
        if (d.brake > 20) adv.brakeLockSamples[i].push(d.tire_slip_ratio[i]);
        if (adv.suspSamples[i].length > 3000) adv.suspSamples[i].shift();
        if (adv.tempSamples[i].length > 3000) adv.tempSamples[i].shift();
        if (adv.wheelSpeedSamples[i].length > 3000) adv.wheelSpeedSamples[i].shift();
        if (adv.brakeLockSamples[i].length > 3000) adv.brakeLockSamples[i].shift();
    }
    adv.slipAngleSamples.front.push(fSlip);
    adv.slipAngleSamples.rear.push(rSlip);
    if (adv.slipAngleSamples.front.length > 3000) { adv.slipAngleSamples.front.shift(); adv.slipAngleSamples.rear.shift(); }
    adv.count++;
}

// ===== CHART RENDERING (runs at lower FPS) =====
setInterval(() => {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'tires') drawTiresCharts();
    if (activeTab === 'gearing') drawGearingCharts();
    if (activeTab === 'advisor') updateAdvisor();
}, 250);

// --- Tire Temp History Chart ---
function drawTiresCharts() {
    drawLineChart('tire-temp-chart', history.tireTemp, ['#448aff','#00e5ff','#ff9100','#ff1744'], ['FL','FR','RL','RR'], '°C');
    drawLineChart('slip-angle-chart', [history.slipAngleFront, history.slipAngleRear], ['#448aff','#ff2d6b'], ['Front','Rear'], 'rad');
    drawGripCircles();
}

function drawLineChart(canvasId, datasets, colors, labels, unit) {
    const c = $(canvasId);
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, ch = h - pad.t - pad.b;

    ctx.clearRect(0, 0, w, h);

    // Find data range
    let minV = Infinity, maxV = -Infinity;
    datasets.forEach(ds => ds.forEach(v => { if (v < minV) minV = v; if (v > maxV) maxV = v; }));
    if (minV === maxV) { minV -= 1; maxV += 1; }
    const range = maxV - minV;
    minV -= range * 0.05;
    maxV += range * 0.05;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.font = '10px Outfit';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i <= 4; i++) {
        const y = pad.t + (ch / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
        const val = maxV - (maxV - minV) * (i / 4);
        ctx.fillText(val.toFixed(1), 4, y + 4);
    }

    // Lines
    const maxLen = Math.max(...datasets.map(d => d.length));
    datasets.forEach((ds, di) => {
        if (ds.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = colors[di];
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.85;
        ds.forEach((v, i) => {
            const x = pad.l + (i / (maxLen - 1)) * cw;
            const y = pad.t + (1 - (v - minV) / (maxV - minV)) * ch;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
    });

    // Legend
    labels.forEach((lbl, i) => {
        const lx = pad.l + i * 70;
        ctx.fillStyle = colors[i];
        ctx.fillRect(lx, h - 14, 12, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(lbl, lx + 16, h - 10);
    });
}

// --- Grip Circles ---
function drawGripCircles() {
    ['grip-fl','grip-fr','grip-rl','grip-rr'].forEach((id, i) => {
        const c = $(id);
        if (!c) return;
        const ctx = c.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        c.width = 140 * dpr; c.height = 140 * dpr;
        ctx.scale(dpr, dpr);
        const cx = 70, cy = 70, r = 55;

        ctx.clearRect(0, 0, 140, 140);

        // Circle boundary
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, r*0.5, 0, Math.PI*2); ctx.stroke();

        // Current slip point
        const latSlip = history.slipAngleFront.length > 0 ?
            (i < 2 ? history.slipAngleFront : history.slipAngleRear).slice(-1)[0] || 0 : 0;
        const lonSlip = history.tireTemp[i].length > 0 ?
            (history.advisor.brakeLockSamples[i].slice(-1)[0] || 0) : 0;

        const dx = Math.max(-1, Math.min(1, latSlip * 5)) * r;
        const dy = Math.max(-1, Math.min(1, lonSlip * 3)) * r;
        const dist = Math.sqrt(dx*dx + dy*dy) / r;

        ctx.beginPath(); ctx.arc(cx + dx, cy - dy, 5, 0, Math.PI*2);
        ctx.fillStyle = dist > 0.8 ? '#ff1744' : dist > 0.5 ? '#ffab00' : '#00e676';
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
        ctx.fill(); ctx.shadowBlur = 0;
    });
}

// ===== GEARING CHARTS =====
function drawGearingCharts() {
    drawGearScatter();
    drawPowerCurve();
    updateShiftTable();
}

function drawGearScatter() {
    const c = $('gear-chart');
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr; c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height;
    const pad = { t: 20, r: 16, b: 28, l: 50 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;

    ctx.clearRect(0, 0, w, h);

    const gearColors = ['','#00e676','#00e5ff','#448aff','#7c4dff','#ff9100','#ff2d6b','#e040fb','#ff6e40','#8d6e63','#78909c'];
    let maxRPM = 8000, maxSpeed = 100;
    Object.values(history.gearData).forEach(pts => pts.forEach(p => {
        if (p.rpm > maxRPM) maxRPM = p.rpm;
        if (p.speed > maxSpeed) maxSpeed = p.speed;
    }));

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    ctx.font = '10px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i <= 5; i++) {
        const y = pad.t + (ch/5)*i;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+cw, y); ctx.stroke();
        ctx.fillText(Math.round(maxRPM - maxRPM*(i/5)), 4, y+4);
    }
    for (let i = 0; i <= 5; i++) {
        const x = pad.l + (cw/5)*i;
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t+ch); ctx.stroke();
        ctx.fillText(Math.round(maxSpeed*(i/5)), x-10, h-8);
    }

    // Points
    Object.entries(history.gearData).forEach(([gear, pts]) => {
        ctx.fillStyle = gearColors[gear] || '#fff';
        ctx.globalAlpha = 0.6;
        pts.forEach(p => {
            const x = pad.l + (p.speed / maxSpeed) * cw;
            const y = pad.t + (1 - p.rpm / maxRPM) * ch;
            ctx.fillRect(x-1, y-1, 3, 3);
        });
        ctx.globalAlpha = 1;
    });

    // Legend
    let lx = pad.l;
    Object.keys(history.gearData).sort((a,b)=>a-b).forEach(g => {
        ctx.fillStyle = gearColors[g] || '#fff';
        ctx.fillRect(lx, h-14, 10, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('G'+g, lx+14, h-10);
        lx += 45;
    });
}

function drawPowerCurve() {
    const c = $('power-chart');
    if (!c || history.powerCurve.length < 10) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr; c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height;
    const pad = { t: 20, r: 16, b: 28, l: 50 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;

    ctx.clearRect(0, 0, w, h);

    // Bin power by RPM
    const bins = {};
    history.powerCurve.forEach(p => {
        const bin = Math.round(p.rpm / 100) * 100;
        if (!bins[bin]) bins[bin] = [];
        bins[bin].push(p.power);
    });

    const sorted = Object.entries(bins).map(([rpm, powers]) => ({
        rpm: +rpm, power: powers.reduce((a,b)=>a+b,0)/powers.length
    })).sort((a,b) => a.rpm - b.rpm);

    if (sorted.length < 2) return;

    const maxRPM = Math.max(...sorted.map(s=>s.rpm));
    const maxPow = Math.max(...sorted.map(s=>s.power));

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    ctx.font = '10px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i <= 4; i++) {
        const y = pad.t + (ch/4)*i;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+cw, y); ctx.stroke();
        ctx.fillText(Math.round(maxPow - maxPow*(i/4))+' HP', 2, y+4);
    }

    // Line
    ctx.beginPath();
    ctx.strokeStyle = '#ff9100'; ctx.lineWidth = 2;
    sorted.forEach((p, i) => {
        const x = pad.l + (p.rpm / maxRPM) * cw;
        const y = pad.t + (1 - p.power / maxPow) * ch;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Peak marker
    const peak = sorted.reduce((a,b) => b.power > a.power ? b : a);
    const px = pad.l + (peak.rpm / maxRPM) * cw;
    const py = pad.t + (1 - peak.power / maxPow) * ch;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2);
    ctx.fillStyle = '#ff9100'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '11px Outfit';
    ctx.fillText(`Peak: ${Math.round(peak.power)} HP @ ${Math.round(peak.rpm)} RPM`, px+10, py-5);
}

function updateShiftTable() {
    const rows = $('shift-rows');
    if (!rows) return;
    const gears = Object.keys(history.gearData).sort((a,b)=>a-b);
    if (gears.length === 0) { rows.innerHTML = '<div class="shift-row"><span>Collecting data...</span></div>'; return; }

    rows.innerHTML = gears.map(g => {
        const pts = history.gearData[g];
        const maxRPM = Math.max(...pts.map(p=>p.rpm));
        const maxSpeed = Math.max(...pts.map(p=>p.speed));
        const maxPower = Math.max(...pts.map(p=>p.power));
        return `<div class="shift-row">
            <span>${g}</span><span>${Math.round(maxRPM)}</span>
            <span>${Math.round(maxSpeed)} km/h</span><span>${Math.round(maxPower)} HP</span>
        </div>`;
    }).join('');
}

// ===== ADVISOR ENGINE =====
// ===== SESSION & ADVISOR ENGINE =====
let isRecording = false;
let sessionLog = [];
let sessionTarget = { type: 'time', value: 2 }; // default 2 minutes
let sessionStart = { time: 0, distance: 0, laps: 0 };

$('btn-start-session').addEventListener('click', () => {
    sessionTarget.type = $('session-type').value;
    sessionTarget.value = parseFloat($('session-val').value) || 1;
    
    sessionLog = [];
    isRecording = true;
    
    // Will capture initial values on the first frame
    sessionStart = null; 

    document.querySelector('.session-form').style.display = 'none';
    $('session-progress-container').style.display = 'block';
    $('advisor-results').style.display = 'none';
});

$('btn-stop-session').addEventListener('click', stopSessionAndAnalyze);

async function stopSessionAndAnalyze() {
    isRecording = false;
    $('session-progress-container').style.display = 'none';
    document.querySelector('.session-form').style.display = 'flex';
    
    if (sessionLog.length < 50) {
        alert('Session too short! Not enough data collected.');
        return;
    }

    $('advisor-results').style.display = 'block';
    $('advisor-cards').innerHTML = '<div class="no-data-msg">Saving log and analyzing...</div>';

    // Save to backend
    try {
        const res = await fetch('/api/logs/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                log: sessionLog,
                specs: getCurrentSpecs()
            })
        });
        if (res.ok) fetchLogs(); // refresh dropdown
    } catch(e) {
        console.error("Failed to save log", e);
    }

    analyzeSession(sessionLog);
}

function recordSessionFrame(d) {
    if (!isRecording) return;
    
    // Init start values
    if (!sessionStart) {
        sessionStart = { time: performance.now(), distance: d.distance_traveled, laps: 0 }; // Laps logic requires lap tracking if not in telemetry
    }
    
    sessionLog.push(d);

    // Update Progress
    let progress = 0;
    let text = '';
    
    if (sessionTarget.type === 'time') {
        const elapsedMin = (performance.now() - sessionStart.time) / 60000;
        progress = (elapsedMin / sessionTarget.value) * 100;
        text = `${elapsedMin.toFixed(2)} / ${sessionTarget.value} Min`;
    } else if (sessionTarget.type === 'distance') {
        const distKm = (d.distance_traveled - sessionStart.distance) / 1000;
        progress = (distKm / sessionTarget.value) * 100;
        text = `${distKm.toFixed(2)} / ${sessionTarget.value} KM`;
    } else if (sessionTarget.type === 'laps') {
        // Approximate lap by massive distance change or just fallback to distance
        // Since lap isn't directly exposed easily, let's treat 'laps' as a ~3km distance for now if not available
        const distKm = (d.distance_traveled - sessionStart.distance) / 1000;
        const lapEquiv = distKm / 3.0; // Assume 3km per lap
        progress = (lapEquiv / sessionTarget.value) * 100;
        text = `~${lapEquiv.toFixed(1)} / ${sessionTarget.value} Laps`;
    }

    $('advisor-progress').style.width = Math.min(100, Math.max(0, progress)) + '%';
    $('session-status-text').textContent = text;

    if (progress >= 100) {
        stopSessionAndAnalyze();
    }
}

// Load Logs
async function fetchLogs() {
    try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        const sel = $('log-select');
        sel.innerHTML = '<option value="">Select a log...</option>' + 
            data.logs.map(l => `<option value="${l}">${l}</option>`).join('');
    } catch (e) { console.error(e); }
}

$('btn-load-log').addEventListener('click', async () => {
    const filename = $('log-select').value;
    if (!filename) return;
    try {
        const res = await fetch('/api/logs/' + filename);
        const logData = await res.json();
        $('advisor-results').style.display = 'block';
        if (logData.log && Array.isArray(logData.log)) {
            if (logData.specs) loadSpecsToUI(logData.specs);
            analyzeSession(logData.log);
        } else {
            analyzeSession(logData);
        }
    } catch (e) {
        alert("Failed to load log.");
    }
});

let currentAnalyzedLog = null;

document.querySelectorAll('.upgrade-toggle input, #car-weight, #car-front-weight, #car-top-speed, #car-gears, #car-target-rpm, #car-tire-radius, #car-spring-f-min, #car-spring-f-max, #car-spring-r-min, #car-spring-r-max, #car-ride-f-min, #car-ride-f-max, #car-ride-r-min, #car-ride-r-max, #car-aero-f-min, #car-aero-f-max, #car-aero-f-cur, #car-aero-r-min, #car-aero-r-max, #car-aero-r-cur').forEach(input => {
    input.addEventListener('change', () => {
        generateSetupSheet();
        if (currentAnalyzedLog) analyzeSession(currentAnalyzedLog);
    });
});

function generateSetupSheet() {
    const s = $('setup-sheet-cards');
    if (!s) return;
    
    const drivetrain = (latestData && latestData.car_ordinal > 0) ? latestData.drivetrain : (currentAnalyzedLog ? (currentAnalyzedLog[0]?.drivetrain || 2) : 2);

    const weightKg = parseFloat($('car-weight')?.value) || 1500;
    const frontPct = parseFloat($('car-front-weight')?.value) || 50;
    const rearPct = 100 - frontPct;

    let springFMin = parseFloat($('car-spring-f-min')?.value);
    let springFMax = parseFloat($('car-spring-f-max')?.value);
    let springRMin = parseFloat($('car-spring-r-min')?.value);
    let springRMax = parseFloat($('car-spring-r-max')?.value);
    
    // Feature 1: Mirror Min/Max if only one axle is provided
    if (!isNaN(springFMin) && !isNaN(springFMax) && (isNaN(springRMin) || isNaN(springRMax))) {
        springRMin = springFMin; springRMax = springFMax;
    } else if (!isNaN(springRMin) && !isNaN(springRMax) && (isNaN(springFMin) || isNaN(springFMax))) {
        springFMin = springRMin; springFMax = springRMax;
    }

    const rideFMin = parseFloat($('car-ride-f-min')?.value);
    const rideRMin = parseFloat($('car-ride-r-min')?.value);

    // Feature 4: Aero Downforce Compensation
    let aeroF = parseFloat($('car-aero-f-cur')?.value);
    if (isNaN(aeroF)) {
        let aMin = parseFloat($('car-aero-f-min')?.value);
        let aMax = parseFloat($('car-aero-f-max')?.value);
        aeroF = (!isNaN(aMin) && !isNaN(aMax)) ? aMin + (aMax - aMin) * 0.8 : 0;
    }
    let aeroR = parseFloat($('car-aero-r-cur')?.value);
    if (isNaN(aeroR)) {
        let aMin = parseFloat($('car-aero-r-min')?.value);
        let aMax = parseFloat($('car-aero-r-max')?.value);
        aeroR = (!isNaN(aMin) && !isNaN(aMax)) ? aMin + (aMax - aMin) * 0.8 : 0;
    }

    let baseSpringF = (weightKg + aeroF * 0.5) * (frontPct / 100) * 0.14;
    let baseSpringR = (weightKg + aeroR * 0.5) * (rearPct / 100) * 0.14;

    if (!isNaN(springFMin) && !isNaN(springFMax)) baseSpringF = (springFMax - springFMin) * (frontPct / 100) + springFMin + (aeroF * 0.05);
    if (!isNaN(springRMin) && !isNaN(springRMax)) baseSpringR = (springRMax - springRMin) * (rearPct / 100) + springRMin + (aeroR * 0.05);
    
    const baseReboundF = baseSpringF * 0.13;
    const baseReboundR = baseSpringR * 0.13;
    const baseBumpF = baseReboundF * 0.6;
    const baseBumpR = baseReboundR * 0.6;
    
    // Feature 3: Drivetrain-Specific ARB Balancing
    let baseArbF = (frontPct / 100) * 65 * 0.5;
    let baseArbR = (rearPct / 100) * 65 * 0.5;
    if (drivetrain === 0) { // FWD
        baseArbF *= 0.8;
        baseArbR *= 1.4;
    } else if (drivetrain === 1) { // RWD
        baseArbF *= 1.2;
        baseArbR *= 0.7;
    } else if (drivetrain === 2) { // AWD
        baseArbF *= 0.9;
        baseArbR *= 1.2;
    }
    
    let baseTire = 1.8 + Math.max(0, (weightKg - 1000) * 0.0003);
    let baseCamberF = -1.5 - ((frontPct - 50) / 100);
    let baseCamberR = -1.0 - ((rearPct - 50) / 100);
    let baseBrakeBal = Math.min(100, Math.max(0, frontPct - 2));

    let html = '<div class="ft-grid">';
    
    // 01 TIRES
    html += `
        <div class="ft-card">
            <div class="ft-header">
                <div class="ft-header-top"><span><b>01</b> SECTION</span><span>F ${baseTire.toFixed(1)} / R ${baseTire.toFixed(1)} BAR</span></div>
                <div class="ft-header-title">TIRES</div>
            </div>
            <div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">${baseTire.toFixed(1)}<span>BAR</span></div></div>
            <div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">${baseTire.toFixed(1)}<span>BAR</span></div></div>
        </div>`;

    // 02 ALIGNMENT
    html += `
        <div class="ft-card">
            <div class="ft-header">
                <div class="ft-header-top"><span><b>02</b> SECTION</span><span>F ${baseCamberF.toFixed(1)}° / R ${baseCamberR.toFixed(1)}°</span></div>
                <div class="ft-header-title">ALIGNMENT</div>
            </div>
            <div class="ft-subhead">CAMBER</div>
            <div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">${baseCamberF.toFixed(1)}<span>°</span></div></div>
            <div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">${baseCamberR.toFixed(1)}<span>°</span></div></div>
            <div class="ft-subhead">TOE</div>
            <div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">0.0<span>°</span></div></div>
            <div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">0.0<span>°</span></div></div>
            <div class="ft-subhead">CASTER</div>
            <div class="ft-row"><div class="ft-row-label">Caster</div><div class="ft-row-value">5.5<span>°</span></div></div>
        </div>`;

    // 03 ANTIROLL BARS
    if ($('upg-arbs')?.checked) {
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>03</b> SECTION</span><span>F ${baseArbF.toFixed(1)} / R ${baseArbR.toFixed(1)}</span></div>
                    <div class="ft-header-title">ANTIROLL BARS</div>
                </div>
                <div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">${baseArbF.toFixed(1)}</div></div>
                <div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">${baseArbR.toFixed(1)}</div></div>
            </div>`;
    }

    // 04 SPRINGS
    if ($('upg-susp')?.checked) {
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>04</b> SECTION</span><span>F ${baseSpringF.toFixed(1)} / R ${baseSpringR.toFixed(1)}</span></div>
                    <div class="ft-header-title">SPRINGS</div>
                </div>
                <div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">${baseSpringF.toFixed(1)}<span>kgf/mm</span></div></div>
                <div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">${baseSpringR.toFixed(1)}<span>kgf/mm</span></div></div>
            </div>`;
    }

    // 05 RIDE HEIGHT
    if ($('upg-susp')?.checked && !isNaN(rideFMin) && !isNaN(rideRMin)) {
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>05</b> SECTION</span><span>F ${rideFMin.toFixed(1)} / R ${rideRMin.toFixed(1)} cm</span></div>
                    <div class="ft-header-title">RIDE HEIGHT</div>
                </div>
                <div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">${rideFMin.toFixed(1)}<span>cm</span></div></div>
                <div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">${rideRMin.toFixed(1)}<span>cm</span></div></div>
            </div>`;
    }

    // 06 DAMPING
    if ($('upg-susp')?.checked) {
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>06</b> SECTION</span><span>B ${baseBumpF.toFixed(1)} / R ${baseReboundF.toFixed(1)}</span></div>
                    <div class="ft-header-title">DAMPING</div>
                </div>
                <div class="ft-subhead">REBOUND</div>
                <div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">${baseReboundF.toFixed(1)}</div></div>
                <div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">${baseReboundR.toFixed(1)}</div></div>
                <div class="ft-subhead">BUMP</div>
                <div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">${baseBumpF.toFixed(1)}</div></div>
                <div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">${baseBumpR.toFixed(1)}</div></div>
            </div>`;
    }

    // 07 AERO
    const aeroFOn = $('upg-aero-f')?.checked;
    const aeroROn = $('upg-aero-r')?.checked;
    if (aeroFOn || aeroROn) {
        let aeroHeaderParts = [];
        if (aeroFOn) aeroHeaderParts.push(`F ${aeroF.toFixed(0)}`);
        if (aeroROn) aeroHeaderParts.push(`R ${aeroR.toFixed(0)}`);
        
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>07</b> SECTION</span><span>${aeroHeaderParts.join(' / ')}</span></div>
                    <div class="ft-header-title">AERO DOWNFORCE</div>
                </div>`;
        if (aeroFOn) {
            html += `<div class="ft-row"><div class="ft-row-label">Front</div><div class="ft-row-value">${aeroF.toFixed(0)}<span>kgf</span></div></div>`;
        }
        if (aeroROn) {
            html += `<div class="ft-row"><div class="ft-row-label">Rear</div><div class="ft-row-value">${aeroR.toFixed(0)}<span>kgf</span></div></div>`;
        }
        html += `</div>`;
    }

    // 08 BRAKES
    if ($('upg-brakes')?.checked) {
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>08</b> SECTION</span><span>BAL ${baseBrakeBal.toFixed(0)}%</span></div>
                    <div class="ft-header-title">BRAKES</div>
                </div>
                <div class="ft-row"><div class="ft-row-label">Balance</div><div class="ft-row-value">${baseBrakeBal.toFixed(0)}<span>%</span></div></div>
                <div class="ft-row"><div class="ft-row-label">Pressure</div><div class="ft-row-value">100<span>%</span></div></div>
            </div>`;
    }

    // 09 DIFFERENTIAL
    if ($('upg-diff')?.checked) {
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>09</b> SECTION</span><span>LOCK</span></div>
                    <div class="ft-header-title">DIFFERENTIAL</div>
                </div>`;
            
    if (drivetrain === 0) {
        html += `
            <div class="ft-subhead">FRONT</div>
            <div class="ft-row"><div class="ft-row-label">Acceleration</div><div class="ft-row-value">50<span>%</span></div></div>
            <div class="ft-row"><div class="ft-row-label">Deceleration</div><div class="ft-row-value">0<span>%</span></div></div>`;
    } else if (drivetrain === 1) {
        html += `
            <div class="ft-subhead">REAR</div>
            <div class="ft-row"><div class="ft-row-label">Acceleration</div><div class="ft-row-value">70<span>%</span></div></div>
            <div class="ft-row"><div class="ft-row-label">Deceleration</div><div class="ft-row-value">15<span>%</span></div></div>`;
    } else {
        html += `
            <div class="ft-subhead">FRONT</div>
            <div class="ft-row"><div class="ft-row-label">Acceleration</div><div class="ft-row-value">30<span>%</span></div></div>
            <div class="ft-row"><div class="ft-row-label">Deceleration</div><div class="ft-row-value">0<span>%</span></div></div>
            <div class="ft-subhead">REAR</div>
            <div class="ft-row"><div class="ft-row-label">Acceleration</div><div class="ft-row-value">70<span>%</span></div></div>
            <div class="ft-row"><div class="ft-row-label">Deceleration</div><div class="ft-row-value">15<span>%</span></div></div>
            <div class="ft-subhead">CENTER</div>
            <div class="ft-row"><div class="ft-row-label">Balance</div><div class="ft-row-value">65<span>%</span></div></div>`;
    }
    
    html += `</div>`;
    }

    // 10 GEARING
    const topSpeedKmh = parseFloat($('car-top-speed')?.value) || 320;
    const numGears = parseInt($('car-gears')?.value, 10) || 6;

    let maxRpm = 8000;
    let wheelRadius = 0.35;
    let hasTelemetryForGears = false;

    let logToUse = null;
    if (latestData && latestData.car_ordinal > 0) logToUse = [latestData];
    else if (currentAnalyzedLog) logToUse = currentAnalyzedLog;

    if (logToUse && logToUse.length > 0) {
        hasTelemetryForGears = true;
        let teleMaxRpm = logToUse[0].max_rpm || 8000;
        
        let peakPower = 0, peakPowerRpm = 0;
        for (let f of logToUse) {
            if (f.power > peakPower) {
                peakPower = f.power;
                peakPowerRpm = f.rpm;
            }
        }
        
        let customRpm = parseInt($('car-target-rpm')?.value, 10);
        if (customRpm > 0) {
            maxRpm = customRpm;
        } else if (peakPowerRpm > 0) {
            maxRpm = peakPowerRpm * 1.05; // gear to 5% past peak power
            if (maxRpm > teleMaxRpm) maxRpm = teleMaxRpm * 0.98;
        } else {
            maxRpm = teleMaxRpm * 0.9;
        }
        
        let radiusSamples = [];
        let backupSamples = [];
        for (let f of logToUse) {
            if (f.speed > 15 && f.wheel_speed) {
                let wMax = Math.max(...f.wheel_speed);
                let wMin = Math.min(...f.wheel_speed);
                let wDiff = wMax - wMin;
                let wAvg = (f.wheel_speed[0] + f.wheel_speed[1] + f.wheel_speed[2] + f.wheel_speed[3]) / 4;
                
                if (wAvg > 10) {
                    let r = f.speed / wAvg;
                    // Strict physical bounds for tire radius (0.25m = 20 inch dia, 0.45m = 35 inch dia)
                    // AND never sample during braking (causes artificially low wAvg, spiking r to 0.45+)
                    // AND never sample during full throttle (causes artificially high wAvg, dropping r to 0.20-)
                    if (r > 0.25 && r < 0.45 && f.brake === 0 && f.accel < 220) {
                        backupSamples.push(r);
                        // Perfect frames: all 4 wheels perfectly synced (no slip at all)
                        if (wDiff < 0.5) {
                            radiusSamples.push(r);
                        }
                    }
                }
            }
        }
        
        let customRadius = parseFloat($('car-tire-radius')?.value);
        if (customRadius > 0) {
            wheelRadius = customRadius;
        } else {
            // If no perfect frames, use the backup samples but sort them to find the median
            if (radiusSamples.length === 0) {
                radiusSamples = backupSamples;
            }
            
            if (radiusSamples.length > 0) {
                radiusSamples.sort((a,b) => a - b);
                wheelRadius = radiusSamples[Math.floor(radiusSamples.length / 2)];
            } else {
                // Fallback to a typical 660mm diameter tire (0.33m radius)
                wheelRadius = 0.33;
            }
            
            // Auto-fill the input so the user can see what was detected and tweak it
            if ($('car-tire-radius')) $('car-tire-radius').placeholder = `Auto (${wheelRadius.toFixed(3)})`;
        }
    } else {
        let customRadius = parseFloat($('car-tire-radius')?.value);
        if (customRadius > 0) wheelRadius = customRadius;
    }

    if (hasTelemetryForGears) {
        const firstGear = 3.30;
        const topGear = 0.85;
        
        const ratioMultiplier = Math.pow(topGear / firstGear, 1 / Math.max(1, numGears - 1));
        
        let ratios = [firstGear];
        for (let i = 1; i < numGears; i++) {
            ratios.push(ratios[i-1] * ratioMultiplier);
        }
        
        const vMaxMs = topSpeedKmh / 3.6;
        const wWheel = vMaxMs / wheelRadius;
        const wEngine = (maxRpm * 2 * Math.PI) / 60;
        const totalRatio = wEngine / wWheel;
        const finalDrive = totalRatio / topGear;
        
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>09</b> SECTION</span><span>FD ${finalDrive.toFixed(2)}</span></div>
                    <div class="ft-header-title">GEARING</div>
                </div>
                <div class="ft-row"><div class="ft-row-label">Final Drive</div><div class="ft-row-value">${finalDrive.toFixed(2)}</div></div>
                <div class="ft-subhead">RATIOS</div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px;">
        `;
        
        ratios.forEach((r, idx) => {
            let suffix = ['ST','ND','RD','TH','TH','TH','TH','TH','TH','TH'][Math.min(idx, 9)];
            html += `<div style="text-align: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                <div style="font-size: 0.65rem; color: var(--text-dim); margin-bottom: 4px;">${idx+1}${suffix}</div>
                <div class="ft-row-value" style="font-size: 1.1rem; color: var(--cyan);">${r.toFixed(2)}</div>
            </div>`;
        });
        
        html += `
                </div>
                <div class="ft-subhead">TOP SPEED (ESTIMATE) *</div>
                <div class="ft-row"><div class="ft-row-label">Estimated</div><div class="ft-row-value">~${topSpeedKmh}<span>km/h</span></div></div>
                <div style="font-size: 0.6rem; color: var(--text-dim); margin-top: 10px; font-style: italic;">* Calibrated to telemetry: Max RPM ${Math.round(maxRpm)}, Tire Radius ${wheelRadius.toFixed(3)}m. If FD is wrong, check Top Speed target.</div>
            </div>
        `;
    } else {
        html += `
            <div class="ft-card">
                <div class="ft-header">
                    <div class="ft-header-top"><span><b>09</b> SECTION</span><span>--</span></div>
                    <div class="ft-header-title">GEARING</div>
                </div>
                <p style="color: var(--text-dim); font-size: 0.85rem;">Requires live telemetry connection or loaded log to calculate tire radius and engine redline.</p>
            </div>
        `;
    }

    html += `</div>`; // end grid

    s.innerHTML = html;
}

function getCurrentSpecs() {
    return {
        name: $('garage-profile-name')?.value.trim() || '',
        weight: parseFloat($('car-weight')?.value) || '',
        front_pct: parseFloat($('car-front-weight')?.value) || '',
        top_speed: parseFloat($('car-top-speed')?.value) || '',
        gears: parseInt($('car-gears')?.value, 10) || '',
        target_rpm: parseInt($('car-target-rpm')?.value, 10) || '',
        tire_radius: parseFloat($('car-tire-radius')?.value) || '',
        spring_f_min: parseFloat($('car-spring-f-min')?.value) || '',
        spring_f_max: parseFloat($('car-spring-f-max')?.value) || '',
        spring_r_min: parseFloat($('car-spring-r-min')?.value) || '',
        spring_r_max: parseFloat($('car-spring-r-max')?.value) || '',
        ride_f_min: parseFloat($('car-ride-f-min')?.value) || '',
        ride_f_max: parseFloat($('car-ride-f-max')?.value) || '',
        ride_r_min: parseFloat($('car-ride-r-min')?.value) || '',
        ride_r_max: parseFloat($('car-ride-r-max')?.value) || '',
        aero_f_min: parseFloat($('car-aero-f-min')?.value) || '',
        aero_f_max: parseFloat($('car-aero-f-max')?.value) || '',
        aero_f_cur: parseFloat($('car-aero-f-cur')?.value) || '',
        aero_r_min: parseFloat($('car-aero-r-min')?.value) || '',
        aero_r_max: parseFloat($('car-aero-r-max')?.value) || '',
        aero_r_cur: parseFloat($('car-aero-r-cur')?.value) || '',
    };
}

function loadSpecsToUI(p) {
    if (!p) return;
    if ($('garage-profile-name')) $('garage-profile-name').value = p.name || '';
    if ($('car-weight')) $('car-weight').value = p.weight || '';
    if ($('car-front-weight')) $('car-front-weight').value = p.front_pct || '';
    if ($('car-top-speed')) $('car-top-speed').value = p.top_speed || '';
    if ($('car-gears')) $('car-gears').value = p.gears || '';
    if ($('car-target-rpm')) $('car-target-rpm').value = p.target_rpm || '';
    if ($('car-tire-radius')) $('car-tire-radius').value = p.tire_radius || '';
    if ($('car-spring-f-min')) $('car-spring-f-min').value = p.spring_f_min || '';
    if ($('car-spring-f-max')) $('car-spring-f-max').value = p.spring_f_max || '';
    if ($('car-spring-r-min')) $('car-spring-r-min').value = p.spring_r_min || '';
    if ($('car-spring-r-max')) $('car-spring-r-max').value = p.spring_r_max || '';
    if ($('car-ride-f-min')) $('car-ride-f-min').value = p.ride_f_min || '';
    if ($('car-ride-f-max')) $('car-ride-f-max').value = p.ride_f_max || '';
    if ($('car-ride-r-min')) $('car-ride-r-min').value = p.ride_r_min || '';
    if ($('car-ride-r-max')) $('car-ride-r-max').value = p.ride_r_max || '';
    if ($('car-aero-f-min')) $('car-aero-f-min').value = p.aero_f_min || '';
    if ($('car-aero-f-max')) $('car-aero-f-max').value = p.aero_f_max || '';
    if ($('car-aero-f-cur')) $('car-aero-f-cur').value = p.aero_f_cur || '';
    if ($('car-aero-r-min')) $('car-aero-r-min').value = p.aero_r_min || '';
    if ($('car-aero-r-max')) $('car-aero-r-max').value = p.aero_r_max || '';
    if ($('car-aero-r-cur')) $('car-aero-r-cur').value = p.aero_r_cur || '';
    generateSetupSheet();
}

if ($('garage-profile-select')) {
    $('garage-profile-select').addEventListener('change', (e) => {
        const idx = e.target.value;
        if (idx !== "" && garageData[currentCarOrdinal]) {
            loadSpecsToUI(garageData[currentCarOrdinal][idx]);
            if (currentAnalyzedLog) analyzeSession(currentAnalyzedLog);
        }
    });
}

if ($('btn-save-garage')) {
    $('btn-save-garage').addEventListener('click', () => {
        if (!currentCarOrdinal) {
            alert("No car detected from telemetry yet.");
            return;
        }
        const specs = getCurrentSpecs();
        if (!specs.name) {
            alert("Please enter a Setup Name.");
            return;
        }
        
        fetch('/api/garage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ car_ordinal: currentCarOrdinal, profile: specs })
        }).then(r => r.json()).then(res => {
            if (res.status === 'ok') {
                fetch('/api/garage').then(r => r.json()).then(data => {
                    garageData = data;
                    onCarChanged(currentCarOrdinal);
                    alert("Setup saved successfully!");
                });
            }
        });
    });
}

function analyzeSession(log) {
    if (!log || log.length < 50) return;
    currentAnalyzedLog = log;
    const cardsGearing = [];
    const cardsTires = [];
    const cardsSusp = [];
    const cardsBrakes = [];

    // Read toggles
    const conf = {
        tires: $('upg-tires')?.checked,
        gears: $('upg-gears')?.checked,
        susp: $('upg-susp')?.checked,
        arbs: $('upg-arbs')?.checked,
        aeroF: $('upg-aero-f')?.checked,
        aeroR: $('upg-aero-r')?.checked,
        brakes: $('upg-brakes')?.checked,
        diff: $('upg-diff')?.checked
    };

    // Read drivetrain from telemetry
    const drivetrain = log[0]?.drivetrain !== undefined ? log[0].drivetrain : 1; // 0=FWD, 1=RWD, 2=AWD

    // Read inputs
    const weightKg = parseFloat($('car-weight')?.value) || 1500;
    const frontPct = parseFloat($('car-front-weight')?.value) || 50;
    const rearPct = 100 - frontPct;

    const springFMin = parseFloat($('car-spring-f-min')?.value);
    const springFMax = parseFloat($('car-spring-f-max')?.value);
    const springRMin = parseFloat($('car-spring-r-min')?.value);
    const springRMax = parseFloat($('car-spring-r-max')?.value);

    const rideFMin = parseFloat($('car-ride-f-min')?.value);
    const rideFMax = parseFloat($('car-ride-f-max')?.value);
    const rideRMin = parseFloat($('car-ride-r-min')?.value);
    const rideRMax = parseFloat($('car-ride-r-max')?.value);

    const aeroFMin = parseFloat($('car-aero-f-min')?.value);
    const aeroFMax = parseFloat($('car-aero-f-max')?.value);
    const aeroRMin = parseFloat($('car-aero-r-min')?.value);
    const aeroRMax = parseFloat($('car-aero-r-max')?.value);

    // --- BASE TUNE MATH (Needed for Corrections) ---
    let baseSpringF = weightKg * (frontPct / 100) * 0.12;
    let baseSpringR = weightKg * (rearPct / 100) * 0.12;

    if (!isNaN(springFMin) && !isNaN(springFMax)) {
        baseSpringF = (springFMax - springFMin) * (frontPct / 100) + springFMin;
    }
    if (!isNaN(springRMin) && !isNaN(springRMax)) {
        baseSpringR = (springRMax - springRMin) * (rearPct / 100) + springRMin;
    }
    const baseReboundF = baseSpringF * 0.13;
    const baseReboundR = baseSpringR * 0.13;
    const baseBumpF = baseReboundF * 0.6;
    const baseBumpR = baseReboundR * 0.6;
    const baseArbF = (frontPct / 100) * 65 * 0.5;
    const baseArbR = (rearPct / 100) * 65 * 0.5;

    // Extract arrays for easier math
    const suspFL = log.map(d => d.susp_travel[0]);
    const suspFR = log.map(d => d.susp_travel[1]);
    const suspRL = log.map(d => d.susp_travel[2]);
    const suspRR = log.map(d => d.susp_travel[3]);
    
    const tempFL = log.map(d => d.tire_temp[0]);
    const tempFR = log.map(d => d.tire_temp[1]);
    const tempRL = log.map(d => d.tire_temp[2]);
    const tempRR = log.map(d => d.tire_temp[3]);

    const slipFront = log.map(d => (Math.abs(d.tire_slip_angle[0]) + Math.abs(d.tire_slip_angle[1])) / 2);
    const slipRear = log.map(d => (Math.abs(d.tire_slip_angle[2]) + Math.abs(d.tire_slip_angle[3])) / 2);

    // --- 1. GEARING ---
    if (conf.gears) {
        let maxSpeed = 0, maxRpm = 0, maxGear = 0, maxRpmLimit = 0;
        let peakPower = 0, peakPowerRpm = 0;
        
        log.forEach(d => {
            if (d.power > peakPower) {
                peakPower = d.power;
                peakPowerRpm = d.rpm;
            }
            if (d.speed > maxSpeed) { maxSpeed = d.speed; maxGear = d.gear; }
            if (d.gear === maxGear && d.rpm > maxRpm) { maxRpm = d.rpm; maxRpmLimit = d.max_rpm; }
        });

        let lastGear = log[0]?.gear || 1;
        let frameCount1st = 0, wheelSpin1stCount = 0;
        let shiftDrops = {};
        let lateShiftsCount = 0;
        let sampleLateShiftRpm = 0;
        
        for (let i = 1; i < log.length; i++) {
            const d = log[i];
            
            // 1st gear traction check
            if (d.gear === 1 && d.accel >= 80 && d.speed < 100) {
                frameCount1st++;
                let slipSum = 0;
                let drivenWheels = 2;
                if (drivetrain === 0) slipSum = Math.abs(d.tire_slip_ratio[0]) + Math.abs(d.tire_slip_ratio[1]);
                else if (drivetrain === 1) slipSum = Math.abs(d.tire_slip_ratio[2]) + Math.abs(d.tire_slip_ratio[3]);
                else {
                    slipSum = Math.abs(d.tire_slip_ratio[0]) + Math.abs(d.tire_slip_ratio[1]) + Math.abs(d.tire_slip_ratio[2]) + Math.abs(d.tire_slip_ratio[3]);
                    drivenWheels = 4;
                }
                if ((slipSum / drivenWheels) > 0.15) wheelSpin1stCount++;
            }
            
            // Shift Detection
            if (d.gear > lastGear && d.gear <= 10) {
                const rpmBefore = log[i-1].rpm;
                const rpmAfter = d.rpm;
                const shiftGear = d.gear;
                
                // Gap Analysis (Did RPM drop too far below peak power?)
                if (rpmAfter > 0 && rpmAfter < peakPowerRpm * 0.78 && rpmBefore > peakPowerRpm * 0.85) {
                    if (!shiftDrops[shiftGear]) shiftDrops[shiftGear] = 0;
                    shiftDrops[shiftGear]++;
                }
                
                // Driver Feedback
                if (rpmBefore > peakPowerRpm * 1.08 && d.accel > 80) {
                    lateShiftsCount++;
                    if (!sampleLateShiftRpm) sampleLateShiftRpm = rpmBefore;
                }
                lastGear = d.gear;
            } else if (d.gear < lastGear) {
                lastGear = d.gear;
            }
        }

        if (lateShiftsCount > 0) {
            cardsGearing.push(makeTuningCard('DRIVER FEEDBACK', 'Shifting Too Late', 
                `You shifted too late ${lateShiftsCount} times. (e.g., at ${Math.round(sampleLateShiftRpm)} RPM, but power peaked at ${Math.round(peakPowerRpm)} RPM).`, 
                'Driving Technique', 'Shift earlier', 'Tip'));
        }
        
        // Output 1st gear traction card
        if (frameCount1st > 20 && wheelSpin1stCount > frameCount1st * 0.5) {
            cardsGearing.push(makeTuningCard('GEARING', 'Excessive Wheel Spin in 1st Gear', 
                `Tires are spinning heavily off the line under full throttle.`, 
                '1st', 'Decrease ratio by ~0.15', 'Longer Gear'));
        }

        // Output Shift Drops
        for (const [g, count] of Object.entries(shiftDrops)) {
            if (count > 0) {
                const gearName = g === '1' ? '1st' : g === '2' ? '2nd' : g === '3' ? '3rd' : g + 'th';
                cardsGearing.push(makeTuningCard('GEARING', `RPM Drop Too Large (${g - 1} -> ${g})`, 
                    `RPM drops too far below the power band when shifting into ${gearName} gear.`, 
                    gearName, 'Increase ratio by ~0.10', 'Shorter Gear'));
            }
        }

        // Final Drive Output
        if (maxGear > 0 && maxSpeed > 100) {
            if (maxRpm > maxRpmLimit * 0.98) {
                cardsGearing.push(makeTuningCard('GEARING', 'Top Speed Limited by Gearing', 
                    `Hitting redline in gear ${maxGear} at ${Math.round(maxSpeed)} km/h.`, 
                    'Final Drive', 'Decrease Final Drive by ~0.15', 'Lower Value'));
            } else if (maxRpm < maxRpmLimit * 0.85 && maxGear > 4) {
                cardsGearing.push(makeTuningCard('GEARING', 'Top Gear Underutilized', 
                    `Only reached ${Math.round(maxRpm)} RPM in top gear (${maxGear}).`, 
                    'Final Drive', 'Increase Final Drive by ~0.20', 'Higher Value'));
            }
        }
    }

    // --- 2. TELEMETRY CORRECTIONS: SPRINGS & RIDE HEIGHT ---
    if (conf.susp) {
        const maxFrontSusp = Math.max(...suspFL, ...suspFR);
        const maxRearSusp = Math.max(...suspRL, ...suspRR);
        
        if (maxFrontSusp > 0.92) {
            const newSpringF = baseSpringF * 1.15;
            cardsSusp.push(makeTuningCard('TELEMETRY CORRECTION', 'Front Suspension Bottoming Out', 
                `Aero/braking is overwhelming base springs. Max travel: ${(maxFrontSusp*100).toFixed(0)}%.`, 
                'Front Springs', `Suggested value: ~${newSpringF.toFixed(1)} kgf/mm`, 'Stiffen'));
        }
        if (maxRearSusp > 0.92) {
            const newSpringR = baseSpringR * 1.15;
            cardsSusp.push(makeTuningCard('TELEMETRY CORRECTION', 'Rear Suspension Bottoming Out', 
                `Aero/acceleration is overwhelming base springs. Max travel: ${(maxRearSusp*100).toFixed(0)}%.`, 
                'Rear Springs', `Suggested value: ~${newSpringR.toFixed(1)} kgf/mm`, 'Stiffen'));
        }
    }

    // --- 3. TELEMETRY CORRECTIONS: DAMPING (Отбой / Сжатие) ---
    if (conf.susp) {
        let highVelocityCount = 0;
        for (let i = 1; i < log.length; i++) {
            const dt = 0.033; 
            const velFL = Math.abs(suspFL[i] - suspFL[i-1]) / dt;
            if (velFL > 8.0) highVelocityCount++; 
        }
        if (highVelocityCount > log.length * 0.05) {
            const newRebound = baseReboundF * 1.15;
            cardsSusp.push(makeTuningCard('TELEMETRY CORRECTION', 'Excessive Suspension Bounce', 
                `Car is bouncing (under-damped).`, 
                'Rebound Stiffness', `Suggested Front Rebound: ~${newRebound.toFixed(1)}`, 'Stiffer'));
        }
    }

    // --- 3.5 TELEMETRY CORRECTIONS: SUSPENSION BOTTOMING OUT ---
    let bottomFrontBrake = 0;
    let bottomRearAccel = 0;
    let bottomFrontBump = 0;
    let bottomRearBump = 0;
    
    for (let i = 0; i < log.length; i++) {
        const d = log[i];
        const minFront = Math.min(d.susp_travel[0], d.susp_travel[1]);
        const minRear = Math.min(d.susp_travel[2], d.susp_travel[3]);
        
        if (minFront < 0.05) {
            if (d.brake > 0) bottomFrontBrake++;
            else bottomFrontBump++;
        }
        if (minRear < 0.05) {
            if (d.accel > 0) bottomRearAccel++;
            else bottomRearBump++;
        }
    }
    
    if (conf.susp) {
        if (bottomFrontBrake > 10) {
            cardsSusp.unshift(makeTuningCard('TELEMETRY CORRECTION', 'Front Bottoming Out (Braking)', 
                `Front suspension hit bottom ${bottomFrontBrake} times under heavy braking.`, 
                'Front Springs / Bump', `Increase stiffness by ~10%`, 'Stiffer'));
        } else if (bottomFrontBump > 15) {
            cardsSusp.unshift(makeTuningCard('TELEMETRY CORRECTION', 'Front Bottoming Out (Bumps)', 
                `Front suspension hit bottom ${bottomFrontBump} times on uneven terrain.`, 
                'Ride Height / Bump', `Raise ride height or stiffen bump`, 'Higher/Stiffer'));
        }
        
        if (bottomRearAccel > 10) {
            cardsSusp.unshift(makeTuningCard('TELEMETRY CORRECTION', 'Rear Bottoming Out (Acceleration)', 
                `Rear suspension hit bottom ${bottomRearAccel} times under heavy acceleration.`, 
                'Rear Springs / Bump', `Increase stiffness by ~10%`, 'Stiffer'));
        } else if (bottomRearBump > 15) {
            cardsSusp.unshift(makeTuningCard('TELEMETRY CORRECTION', 'Rear Bottoming Out (Bumps)', 
                `Rear suspension hit bottom ${bottomRearBump} times on uneven terrain.`, 
                'Ride Height / Bump', `Raise ride height or stiffen bump`, 'Higher/Stiffer'));
        }
    }

    // --- 4. TELEMETRY CORRECTIONS: ANTI-ROLL BARS (Balance Index) ---
    let frontSlipIntegral = 0;
    let rearSlipIntegral = 0;
    let highGCountLowSpd = 0;
    let highGCountHighSpd = 0;
    let frontSlipIntHighSpd = 0, rearSlipIntHighSpd = 0;
    
    for (let i = 0; i < log.length; i++) {
        const latG = Math.abs(log[i].g_lat);
        if (latG > 0.5) { // Cornering hard
            if (log[i].speed > 50 && log[i].speed < 140) { // ARB territory
                frontSlipIntegral += slipFront[i];
                rearSlipIntegral += slipRear[i];
                highGCountLowSpd++;
            } else if (log[i].speed >= 140) { // Aero territory
                frontSlipIntHighSpd += slipFront[i];
                rearSlipIntHighSpd += slipRear[i];
                highGCountHighSpd++;
            }
        }
    }
    
    // ARBs Check
    if (highGCountLowSpd > 30 && conf.arbs) {
        const balance = frontSlipIntegral / (rearSlipIntegral || 1);
        if (balance > 1.15) {
            const adjustment = Math.min((balance - 1.15) * 10, 10);
            const newArbF = Math.max(1, baseArbF - adjustment);
            cardsSusp.push(makeTuningCard('TELEMETRY CORRECTION', 'Low-Speed Understeer detected', 
                `Front sliding ${((balance-1)*100).toFixed(0)}% more than rear.`, 
                'Front ARB', `Suggested value: ~${newArbF.toFixed(1)}`, 'Softer'));
        } else if (balance < 0.85) {
            const adjustment = Math.min((0.85 - balance) * 10, 10);
            const newArbR = Math.max(1, baseArbR - adjustment);
            cardsSusp.push(makeTuningCard('TELEMETRY CORRECTION', 'Low-Speed Oversteer detected', 
                `Rear sliding ${((1-balance)*100).toFixed(0)}% more than front.`, 
                'Rear ARB', `Suggested value: ~${newArbR.toFixed(1)}`, 'Softer'));
        }
    }

    // Aero Check
    if (highGCountHighSpd > 30) {
        const balanceHigh = frontSlipIntHighSpd / (rearSlipIntHighSpd || 1);
        if (balanceHigh > 1.15 && conf.aeroF) {
            let suggestAero = 'Increase Downforce';
            if (!isNaN(aeroFMax)) suggestAero = `Suggested value: ~${(aeroFMax * 0.85).toFixed(0)}`;
            cardsSusp.push(makeTuningCard('TELEMETRY CORRECTION', 'High-Speed Understeer', 
                `Front losing grip at speeds > 140km/h. Balance Index: ${balanceHigh.toFixed(2)}`, 
                'Front Aero', suggestAero, 'Cornering'));
        } else if (balanceHigh < 0.85 && conf.aeroR) {
            let suggestAero = 'Increase Downforce';
            if (!isNaN(aeroRMax)) suggestAero = `Suggested value: ~${(aeroRMax * 0.85).toFixed(0)}`;
            cardsSusp.push(makeTuningCard('TELEMETRY CORRECTION', 'High-Speed Oversteer', 
                `Rear losing grip at speeds > 140km/h. Balance Index: ${balanceHigh.toFixed(2)}`, 
                'Rear Aero', suggestAero, 'Cornering'));
        }
    }

    // --- 5. CAMBER & TIRE PRESSURE ---
    const avgFL = avg(tempFL), avgFR = avg(tempFR);
    const avgRL = avg(tempRL), avgRR = avg(tempRR);
    const avgFrontTemp = (avgFL + avgFR) / 2;
    const avgRearTemp = (avgRL + avgRR) / 2;

    if (avgFrontTemp > 105) {
        if (conf.susp) {
            cardsTires.push(makeTuningCard('ALIGNMENT', 'Front Tires Overheating', 
                `Fronts averaging ${avgFrontTemp.toFixed(0)}°C. Reduce sliding by adjusting Camber.`, 
                'Front Camber', 'Add -0.3° to -0.5°', 'More Negative'));
        }
        if (conf.tires) {
            cardsTires.push(makeTuningCard('TIRE PRESSURE', 'Reduce Front Pressure', 
                `Spread the heat.`, 'Front Pressure', 'Decrease by 0.05-0.1 bar', 'Lower'));
        }
    }
    
    if (avgRearTemp > 105) {
        if (conf.susp) {
            cardsTires.push(makeTuningCard('ALIGNMENT', 'Rear Tires Overheating', 
                `Rears averaging ${avgRearTemp.toFixed(0)}°C.`, 
                'Rear Camber', 'Add -0.2° to -0.4°', 'More Negative'));
        }
        if (conf.tires) {
            cardsTires.push(makeTuningCard('TIRE PRESSURE', 'Reduce Rear Pressure', 
                `Spread the heat.`, 'Rear Pressure', 'Decrease by 0.05-0.1 bar', 'Lower'));
        }
    }

    // Caster (High speed straight stability)
    if (conf.susp) {
        // If high steering angle applied at high speed (wobbly)
        let wobblyCount = 0;
        for (let i = 0; i < log.length; i++) {
            if (log[i].speed > 150 && Math.abs(log[i].steer) > 30 && slipFront[i] < 0.05) wobblyCount++;
        }
        if (wobblyCount > 30) {
            cardsTires.push(makeTuningCard('ALIGNMENT', 'High Speed Instability', 
                `Frequent steering corrections detected on straights.`, 
                'Front Caster', 'Increase by 0.5', 'Higher Angle'));
        }
    }

    // --- 6. BRAKES ---
    if (conf.brakes) {
        let frontLocks = 0, rearLocks = 0, brakeFrames = 0;
        for(let i=0; i<log.length; i++) {
            if (log[i].brake > 20) {
                brakeFrames++;
                const fl = log[i].tire_slip_ratio[0];
                const rl = log[i].tire_slip_ratio[2];
                if (fl < -0.25) frontLocks++;
                if (rl < -0.25) rearLocks++;
            }
        }
        if (brakeFrames > 20) {
            if (frontLocks > brakeFrames * 0.3) {
                cardsBrakes.push(makeTuningCard('BRAKES', 'Front Wheels Locking', 
                    `Front tires lock up under heavy braking.`, 
                    'Brake Balance', 'Shift bias towards REAR (48-45%)', 'More Rear Bias'));
            } else if (rearLocks > brakeFrames * 0.3) {
                cardsBrakes.push(makeTuningCard('BRAKES', 'Rear Wheels Locking', 
                    `Rear tires lock up under braking (causes spin-outs).`, 
                    'Brake Balance', 'Shift bias towards FRONT (52-55%)', 'More Front Bias'));
            }
        }
    }

    // --- 7. DIFFERENTIAL ---
    if (conf.diff) {
        let diffSum = 0, diffSamples = 0;
        for(let i=0; i<log.length; i++) {
            if (log[i].accel > 50 && log[i].speed > 20) { 
                const rl = log[i].wheel_speed[2];
                const rr = log[i].wheel_speed[3];
                const av = (Math.abs(rl) + Math.abs(rr)) / 2;
                if (av > 0) { diffSum += Math.abs(rl - rr) / av; diffSamples++; }
            }
        }
        if (diffSamples > 20 && (diffSum / diffSamples) > 0.12) {
            cardsBrakes.push(makeTuningCard('DIFFERENTIAL', 'Inside Wheel Spinning', 
                `Rear wheels have >12% speed difference under power. Losing acceleration out of corners.`, 
                'Rear Accel Lock', 'Increase by 10-15%', 'Higher Lock'));
        }
    }

    // Hide placeholder, show results
    $('advisor-placeholder').style.display = 'none';
    $('advisor-results').style.display = 'block';

    const totalCards = cardsGearing.length + cardsTires.length + cardsSusp.length + cardsBrakes.length;
    if (totalCards === 0) {
        $('advisor-no-data').style.display = 'block';
    } else {
        $('advisor-no-data').style.display = 'none';
    }

    // Render Gearing
    if (cardsGearing.length > 0) {
        $('advisor-cards-gearing').innerHTML = cardsGearing.join('');
    } else {
        $('advisor-cards-gearing').innerHTML = '<div class="no-data-msg" style="margin-top: 10px;">Gearing looks optimal based on data.</div>';
    }

    // Render Tires
    if (cardsTires.length > 0) {
        $('advisor-cards-tires').innerHTML = cardsTires.join('');
    } else {
        $('advisor-cards-tires').innerHTML = '<div class="no-data-msg" style="margin-top: 10px;">Tires & Alignment look optimal based on data.</div>';
    }

    // Render Susp
    if (cardsSusp.length > 0) {
        $('sec-susp').style.display = 'block';
        $('advisor-cards-susp').innerHTML = cardsSusp.join('');
    } else {
        $('sec-susp').style.display = 'none';
    }

    // Render Brakes & Diff
    if (cardsBrakes.length > 0) {
        $('sec-brakes').style.display = 'block';
        $('advisor-cards-brakes').innerHTML = cardsBrakes.join('');
    } else {
        $('sec-brakes').style.display = 'none';
    }
}

function makeTuningCard(category, title, desc, paramName, actionText, actionType) {
    return `
        <div class="advisor-card tuning">
            <div class="card-category">${category}</div>
            <div class="card-title">${title}</div>
            <div class="card-desc">${desc}</div>
            <div class="tune-slider">
                <div class="tune-slider-header">
                    <span>${paramName}</span>
                    <span class="tune-slider-val">${actionType}</span>
                </div>
                <div class="tune-slider-action">Suggestion: <b>${actionText}</b></div>
            </div>
        </div>
    `;
}

function avg(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a,b) => a+b, 0) / arr.length;
}

// ===== INIT =====
connect();
fetchLogs();
