const speedVal = document.getElementById('speed-val');
const gearVal = document.getElementById('gear-val');
const rpmVal = document.getElementById('rpm-val');
const rpmBar = document.getElementById('rpm-bar');
const throttleBar = document.getElementById('throttle-bar');
const throttleVal = document.getElementById('throttle-val');
const brakeBar = document.getElementById('brake-bar');
const brakeVal = document.getElementById('brake-val');
const steerIndicator = document.getElementById('steer-indicator');
const steerVal = document.getElementById('steer-val');
const statusText = document.getElementById('connection-status');
const statusContainer = document.querySelector('.status');

let ws;

function connect() {
    ws = new WebSocket(`ws://${window.location.host}/ws`);

    ws.onopen = () => {
        statusText.textContent = 'Connected to FH6';
        statusContainer.classList.add('connected');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        updateDashboard(data);
    };

    ws.onclose = () => {
        statusText.textContent = 'Disconnected. Reconnecting...';
        statusContainer.classList.remove('connected');
        setTimeout(connect, 2000);
    };

    ws.onerror = (error) => {
        console.error("WebSocket Error: ", error);
        ws.close();
    };
}

function updateDashboard(data) {
    // Update Text Values
    speedVal.textContent = Math.floor(data.speed);
    
    // Handle Gear Logic (0 = Reverse)
    if (data.gear === 0 && data.speed > 0) {
        gearVal.textContent = 'R';
    } else if (data.gear === 0 && data.speed === 0) {
        gearVal.textContent = 'N';
    } else {
        gearVal.textContent = data.gear;
    }

    rpmVal.textContent = Math.floor(data.rpm);

    // Update RPM Bar (Calculate percentage)
    let maxRpm = data.max_rpm > 0 ? data.max_rpm : 8000;
    let rpmPercent = (data.rpm / maxRpm) * 100;
    rpmPercent = Math.max(0, Math.min(100, rpmPercent)); // Clamp between 0-100
    rpmBar.style.width = `${rpmPercent}%`;

    // Change RPM color near redline
    if (rpmPercent > 90) {
        rpmBar.style.background = 'linear-gradient(90deg, #ff003c, #ff3366)';
        rpmBar.style.boxShadow = '0 0 20px rgba(255, 0, 60, 0.8)';
    } else {
        rpmBar.style.background = 'linear-gradient(90deg, var(--accent-cyan), var(--accent-magenta))';
        rpmBar.style.boxShadow = '0 0 20px rgba(255, 0, 60, 0.5)';
    }

    // Update Pedals
    throttleBar.style.height = `${data.accel}%`;
    throttleVal.textContent = `${Math.floor(data.accel)}%`;

    brakeBar.style.height = `${data.brake}%`;
    brakeVal.textContent = `${Math.floor(data.brake)}%`;

    // Update Steering (Steer value is -100 to 100, we map it to 0% to 100% left)
    // -100 is full left, 100 is full right.
    // CSS left is 50% at center.
    // We want left to go from 0% to 100%.
    // So 50 + (steer / 2)
    let steerPercent = 50 + (data.steer / 2);
    steerPercent = Math.max(0, Math.min(100, steerPercent));
    steerIndicator.style.left = `${steerPercent}%`;
    steerVal.textContent = `${Math.abs(Math.floor(data.steer))}% ${data.steer < 0 ? 'L' : (data.steer > 0 ? 'R' : '')}`;
}

// Initialize connection
connect();
