/**
 * Centauri Carbon SafePrint Frontend Application
 */

// State variables
let currentPrinterState = null;
let currentTimerState = null;
let selectedAction = 'pause';
let selectedPresetMins = 45;
let audioContext = null;
let cameraActive = false;

// Audio Synthesizer using Web Audio API
function initAudio() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioContext = new AudioContextClass();
    }
  }
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function playBeep(frequency = 880, duration = 0.15, type = 'sine') {
  try {
    initAudio();
    if (!audioContext) return;

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, audioContext.currentTime);

    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start();
    osc.stop(audioContext.currentTime + duration);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

function playWarningAlarm() {
  if (!document.getElementById('chk-audio').checked) return;
  // Two soft attention beeps
  playBeep(659.25, 0.12, 'sine'); // E5
  setTimeout(() => playBeep(880, 0.25, 'sine'), 160); // A5
}

function playTriggerAlarm() {
  if (!document.getElementById('chk-audio').checked) return;
  // Urgent three-tone chime
  playBeep(523.25, 0.15, 'triangle'); // C5
  setTimeout(() => playBeep(659.25, 0.15, 'triangle'), 180); // E5
  setTimeout(() => playBeep(783.99, 0.15, 'triangle'), 360); // G5
  setTimeout(() => playBeep(1046.50, 0.45, 'triangle'), 540); // C6
}

// Desktop Notifications
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showNotification(title, body) {
  if (!document.getElementById('chk-notif').checked) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220%22%20width=%22100%22%20height=%22100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>'
      });
    } catch (e) {}
  }
}

// Formatting utilities
function formatSecondsToClock(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatTicksToTime(ticks) {
  if (!ticks || ticks <= 0) return '0m';
  const mins = Math.round(ticks / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Server-Sent Events (SSE) listener
function setupSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('init', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateUI(data.timer, data.printer);
    } catch (err) {}
  });

  eventSource.addEventListener('update', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateUI(data.timer, data.printer);
    } catch (err) {}
  });

  eventSource.addEventListener('warning', (e) => {
    playWarningAlarm();
    showNotification('Centauri SafePrint: 1 Minute Remaining', 'The printer countdown will trigger action in 60 seconds!');
  });

  eventSource.addEventListener('triggered', (e) => {
    playTriggerAlarm();
    try {
      const data = JSON.parse(e.data);
      const actionName = data.action === 'stop' ? 'STOPPED' : 'PAUSED';
      showNotification('Centauri SafePrint: Action Executed!', `The print was ${actionName} successfully.`);
    } catch (err) {}
  });

  eventSource.addEventListener('log', (e) => {
    try {
      const logEntry = JSON.parse(e.data);
      appendLog(logEntry);
    } catch (err) {}
  });

  eventSource.onerror = () => {
    // If SSE drops, fallback to polling
    pollStatus();
  };
}

// Polling fallback
async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateUI(data.timer, data.printer);
  } catch (err) {}
}

// UI Updating
function updateUI(timer, printer) {
  currentTimerState = timer;
  currentPrinterState = printer;

  // 1. Connection status
  const badge = document.getElementById('connection-badge');
  const badgeText = document.getElementById('connection-status-text');
  const ipDisplay = document.getElementById('printer-ip-display');
  const webBtn = document.getElementById('btn-printer-web');

  // Multi-signal connection detection:
  // If printer connected flag is true, or if live telemetry is actively arriving, it is connected
  const isConnected = Boolean(
    printer && (
      printer.connected || 
      printer.isPrinting ||
      (printer.printStatus && printer.printStatus > 0) ||
      (printer.temperatures && (printer.temperatures.nozzle > 0 || printer.temperatures.bed > 0)) ||
      (printer.filename && printer.filename.length > 0)
    )
  );

  if (isConnected) {
    badge.className = 'connection-badge connected';
    badgeText.textContent = `Centauri Connected (${printer.host})`;
  } else if (printer && printer.connecting) {
    badge.className = 'connection-badge';
    badgeText.textContent = 'Connecting to printer...';
  } else {
    badge.className = 'connection-badge disconnected';
    badgeText.textContent = 'Disconnected';
  }

  if (printer && printer.host) {
    ipDisplay.textContent = printer.host;
    webBtn.href = `http://${printer.host}/network-device-manager/network/control`;
  }

  // 2. Timer state & UI
  updateTimerCard(timer);

  // 3. Printer Telemetry & UI
  updatePrinterTelemetry(printer);
}

function updateTimerCard(timer) {
  const clock = document.getElementById('timer-countdown');
  const subtext = document.getElementById('timer-subtext');
  const progressBar = document.getElementById('timer-progress-bar');
  const badge = document.getElementById('timer-badge');
  const btnStart = document.getElementById('btn-timer-start');
  const btnPause = document.getElementById('btn-timer-pause');
  const btnCancel = document.getElementById('btn-timer-cancel');
  const adjustContainer = document.getElementById('adjust-container');
  const presetsContainer = document.getElementById('presets-container');
  const customInputsContainer = document.getElementById('custom-inputs-container');

  if (!timer || !timer.active) {
    // Inactive timer
    badge.className = 'status-pill idle';
    badge.textContent = 'IDLE';
    clock.className = 'timer-clock';
    
    // Set clock to input values or 00:00:00
    const h = parseInt(document.getElementById('input-hours').value, 10) || 0;
    const m = parseInt(document.getElementById('input-minutes').value, 10) || 0;
    const s = parseInt(document.getElementById('input-seconds').value, 10) || 0;
    const totalSecs = (h * 3600) + (m * 60) + s;
    clock.textContent = formatSecondsToClock(totalSecs);
    
    progressBar.style.width = '0%';
    subtext.textContent = 'Set a countdown duration to guard your 3D print';

    btnStart.classList.remove('hidden');
    btnStart.textContent = '▶ START SAFE TIMER';
    btnPause.classList.add('hidden');
    btnCancel.classList.add('hidden');
    adjustContainer.classList.add('hidden');
    presetsContainer.classList.remove('hidden');
    customInputsContainer.classList.remove('hidden');

    if (timer && timer.triggered) {
      badge.className = 'status-pill warning';
      badge.textContent = 'TRIGGERED';
      subtext.textContent = `Action executed: ${timer.triggerReason || 'Time elapsed'}!`;
    }
  } else {
    // Active running timer
    clock.textContent = formatSecondsToClock(timer.remainingSeconds);
    progressBar.style.width = `${timer.progressPercent}%`;

    presetsContainer.classList.add('hidden');
    customInputsContainer.classList.add('hidden');
    adjustContainer.classList.remove('hidden');
    btnStart.classList.add('hidden');
    btnPause.classList.remove('hidden');
    btnCancel.classList.remove('hidden');

    const actionText = timer.action === 'stop' ? 'Stop Print' : 'Pause Print';

    if (timer.paused) {
      badge.className = 'status-pill paused';
      badge.textContent = 'PAUSED';
      clock.className = 'timer-clock';
      subtext.textContent = `Timer paused. Scheduled action: ${actionText}`;
      btnPause.textContent = '▶ Resume Timer';
    } else {
      badge.className = 'status-pill active';
      badge.textContent = 'COUNTING';
      btnPause.textContent = '⏸ Pause Timer';

      if (timer.remainingSeconds <= 60) {
        clock.className = 'timer-clock pulse-warning';
        subtext.textContent = `⚠️ ATTENTION: Less than 1 minute remaining until ${actionText}!`;
      } else {
        clock.className = 'timer-clock pulse-active';
        const endFormatted = timer.endTime ? new Date(timer.endTime).toLocaleTimeString('en-US', { hour12: false }) : '';
        subtext.textContent = `Scheduled action: ${actionText} at ${endFormatted}`;
      }
    }
  }
}

function updatePrinterTelemetry(printer) {
  if (!printer) return;

  // Status pill
  const pill = document.getElementById('printer-status-pill');
  pill.textContent = printer.printStatusText;
  if (printer.isPrinting) {
    pill.className = 'status-pill printing';
  } else if (printer.isPaused) {
    pill.className = 'status-pill paused';
  } else {
    pill.className = 'status-pill idle';
  }

  // Job Info
  document.getElementById('telemetry-filename').textContent = printer.filename || '(No active print job)';
  document.getElementById('telemetry-progress-val').textContent = `${printer.progress}%`;
  document.getElementById('telemetry-progress-bar').style.width = `${printer.progress}%`;
  document.getElementById('telemetry-layer').textContent = `${printer.currentLayer} / ${printer.totalLayer}`;
  document.getElementById('telemetry-elapsed').textContent = formatTicksToTime(printer.currentTicks);
  
  const remainingTicks = Math.max(0, printer.totalTicks - printer.currentTicks);
  document.getElementById('telemetry-remaining').textContent = formatTicksToTime(remainingTicks);
  document.getElementById('telemetry-speed').textContent = `${printer.printSpeedPct}%`;

  // Temperatures
  const nozzle = printer.temperatures.nozzle;
  const nozzleTgt = printer.temperatures.nozzleTarget;
  document.getElementById('temp-nozzle').textContent = `${nozzle}°C ${nozzleTgt > 0 ? '/ ' + nozzleTgt + '°C' : ''}`;
  document.getElementById('bar-nozzle').style.width = `${Math.min(100, Math.max(5, (nozzle / 300) * 100))}%`;

  const bed = printer.temperatures.bed;
  const bedTgt = printer.temperatures.bedTarget;
  document.getElementById('temp-bed').textContent = `${bed}°C ${bedTgt > 0 ? '/ ' + bedTgt + '°C' : ''}`;
  document.getElementById('bar-bed').style.width = `${Math.min(100, Math.max(5, (bed / 110) * 100))}%`;

  const box = printer.temperatures.box;
  document.getElementById('temp-box').textContent = `${box}°C`;
  document.getElementById('bar-box').style.width = `${Math.min(100, Math.max(5, (box / 70) * 100))}%`;

  // Update Camera URL if active
  if (cameraActive && printer.videoUrl) {
    const camImg = document.getElementById('camera-stream');
    if (!camImg.src.includes(printer.host)) {
      camImg.src = printer.videoUrl;
    }
  }
}

function appendLog(logEntry) {
  const container = document.getElementById('logs-list');
  const entry = document.createElement('div');
  entry.className = `log-entry ${logEntry.type || 'info'}`;
  entry.innerHTML = `
    <span class="log-time">[${logEntry.time}]</span>
    <span class="log-msg">${logEntry.message}</span>
  `;
  container.prepend(entry);
}

// Preset and Input Handlers
function setupInputsAndPresets() {
  const presets = document.querySelectorAll('.btn-preset');
  presets.forEach(btn => {
    btn.addEventListener('click', () => {
      presets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const mins = parseInt(btn.dataset.mins, 10);
      selectedPresetMins = mins;

      const h = Math.floor(mins / 60);
      const m = mins % 60;
      document.getElementById('input-hours').value = h;
      document.getElementById('input-minutes').value = m;
      document.getElementById('input-seconds').value = 0;

      updateClockFromInputs();
    });
  });

  ['input-hours', 'input-minutes', 'input-seconds'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      presets.forEach(b => b.classList.remove('active'));
      updateClockFromInputs();
    });
  });

  // Action toggles (Pause vs Stop)
  const optionPause = document.getElementById('option-pause');
  const optionStop = document.getElementById('option-stop');

  optionPause.addEventListener('click', () => {
    optionPause.classList.add('active');
    optionStop.classList.remove('active');
    selectedAction = 'pause';
  });

  optionStop.addEventListener('click', () => {
    optionStop.classList.add('active');
    optionPause.classList.remove('active');
    selectedAction = 'stop';
  });
}

function updateClockFromInputs() {
  if (currentTimerState && currentTimerState.active) return;
  const h = parseInt(document.getElementById('input-hours').value, 10) || 0;
  const m = parseInt(document.getElementById('input-minutes').value, 10) || 0;
  const s = parseInt(document.getElementById('input-seconds').value, 10) || 0;
  const totalSecs = (h * 3600) + (m * 60) + s;
  document.getElementById('timer-countdown').textContent = formatSecondsToClock(totalSecs);
}

// Setup Action Buttons
function setupActionButtons() {
  // Start Timer
  document.getElementById('btn-timer-start').addEventListener('click', async () => {
    initAudio();
    requestNotificationPermission();

    const h = parseInt(document.getElementById('input-hours').value, 10) || 0;
    const m = parseInt(document.getElementById('input-minutes').value, 10) || 0;
    const s = parseInt(document.getElementById('input-seconds').value, 10) || 0;
    const totalSeconds = (h * 3600) + (m * 60) + s;

    if (totalSeconds <= 0) {
      alert('Please set a duration greater than 0 seconds.');
      return;
    }

    const targetLayer = document.getElementById('input-target-layer').value;
    const targetProgress = document.getElementById('input-target-progress').value;

    try {
      const res = await fetch('/api/timer/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seconds: totalSeconds,
          action: selectedAction,
          targetLayer: targetLayer || null,
          targetProgress: targetProgress || null
        })
      });
      const data = await res.json();
      if (data.timer) {
        updateTimerCard(data.timer);
      }
    } catch (err) {
      alert('Error starting timer: ' + err.message);
    }
  });

  // Pause / Resume Timer
  document.getElementById('btn-timer-pause').addEventListener('click', async () => {
    if (!currentTimerState) return;
    const endpoint = currentTimerState.paused ? '/api/timer/resume' : '/api/timer/pause';
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.timer) updateTimerCard(data.timer);
    } catch (err) {}
  });

  // Cancel Timer
  document.getElementById('btn-timer-cancel').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/timer/cancel', { method: 'POST' });
      const data = await res.json();
      if (data.timer) updateTimerCard(data.timer);
    } catch (err) {}
  });

  // Adjust Timer (+1m, +5m, +10m, +30m, -5m)
  document.querySelectorAll('.btn-adjust').forEach(btn => {
    btn.addEventListener('click', async () => {
      const delta = parseInt(btn.dataset.adjust, 10);
      try {
        const res = await fetch('/api/timer/adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deltaSeconds: delta })
        });
        const data = await res.json();
        if (data.timer) updateTimerCard(data.timer);
      } catch (err) {}
    });
  });

  // Manual Direct Controls
  document.getElementById('btn-manual-pause').addEventListener('click', async () => {
    try {
      await fetch('/api/printer/pause', { method: 'POST' });
    } catch (err) {}
  });

  document.getElementById('btn-manual-resume').addEventListener('click', async () => {
    try {
      await fetch('/api/printer/resume', { method: 'POST' });
    } catch (err) {}
  });

  // Manual Stop with Modal
  const stopModal = document.getElementById('modal-confirm-stop');
  document.getElementById('btn-manual-stop').addEventListener('click', () => {
    stopModal.classList.remove('hidden');
  });

  document.getElementById('btn-confirm-stop-cancel').addEventListener('click', () => {
    stopModal.classList.add('hidden');
  });

  document.getElementById('btn-confirm-stop-execute').addEventListener('click', async () => {
    stopModal.classList.add('hidden');
    try {
      await fetch('/api/printer/stop', { method: 'POST' });
    } catch (err) {}
  });

  // Camera Toggle
  const btnToggleCam = document.getElementById('btn-toggle-camera');
  const btnStartCam = document.getElementById('btn-start-camera-stream');
  const camImg = document.getElementById('camera-stream');
  const camPlaceholder = document.getElementById('camera-placeholder');

  async function activateCamera() {
    cameraActive = true;
    camPlaceholder.classList.add('hidden');
    camImg.classList.remove('hidden');
    btnToggleCam.textContent = 'Disable';

    try {
      await fetch('/api/printer/camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: true })
      });
      if (currentPrinterState && currentPrinterState.videoUrl) {
        camImg.src = currentPrinterState.videoUrl + '?t=' + Date.now();
      }
    } catch (e) {}
  }

  function deactivateCamera() {
    cameraActive = false;
    camImg.classList.add('hidden');
    camPlaceholder.classList.remove('hidden');
    btnToggleCam.textContent = 'Enable Camera';
    camImg.src = '';
  }

  btnToggleCam.addEventListener('click', () => {
    if (cameraActive) deactivateCamera();
    else activateCamera();
  });

  btnStartCam.addEventListener('click', activateCamera);

  // Audio test button
  document.getElementById('btn-test-sound').addEventListener('click', () => {
    playWarningAlarm();
    setTimeout(playTriggerAlarm, 600);
  });

  // Clear logs button
  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    document.getElementById('logs-list').innerHTML = '';
  });

  // IP Modal & Discovery
  const ipModal = document.getElementById('modal-ip');
  const discoveryStatus = document.getElementById('discovery-status');
  const discoveryList = document.getElementById('discovery-list');
  const btnDiscover = document.getElementById('btn-discover-printers');

  document.getElementById('btn-edit-ip').addEventListener('click', () => {
    if (currentPrinterState && currentPrinterState.host) {
      document.getElementById('input-printer-ip').value = currentPrinterState.host;
    }
    discoveryStatus.classList.add('hidden');
    discoveryList.classList.add('hidden');
    discoveryList.innerHTML = '';
    ipModal.classList.remove('hidden');
  });

  document.getElementById('modal-close').addEventListener('click', () => {
    ipModal.classList.add('hidden');
  });

  document.getElementById('modal-btn-cancel').addEventListener('click', () => {
    ipModal.classList.add('hidden');
  });

  document.getElementById('modal-btn-save').addEventListener('click', async () => {
    const newIp = document.getElementById('input-printer-ip').value.trim();
    if (!newIp) return;
    ipModal.classList.add('hidden');

    try {
      await fetch('/api/printer/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: newIp })
      });
    } catch (e) {}
  });

  // Auto-Discover Network Printers
  btnDiscover.addEventListener('click', async () => {
    btnDiscover.disabled = true;
    btnDiscover.textContent = '⏳ Scanning...';
    discoveryStatus.className = 'discovery-status scanning';
    discoveryStatus.textContent = 'Scanning local network for Elegoo Centauri Carbon...';
    discoveryStatus.classList.remove('hidden');
    discoveryList.classList.add('hidden');
    discoveryList.innerHTML = '';

    try {
      const res = await fetch('/api/printer/discover', { method: 'POST' });
      const data = await res.json();

      if (data.success && data.printers && data.printers.length > 0) {
        discoveryStatus.className = 'discovery-status success';
        discoveryStatus.textContent = `Found ${data.printers.length} printer(s) on your network:`;
        discoveryList.classList.remove('hidden');

        // Auto-select first discovered printer
        document.getElementById('input-printer-ip').value = data.printers[0].ip;

        data.printers.forEach(printer => {
          const item = document.createElement('div');
          item.className = 'discovery-item';
          item.innerHTML = `
            <div>
              <span class="discovery-item-name">${printer.brand || 'ELEGOO'} ${printer.name}</span>
              <span class="discovery-item-ip">${printer.ip}</span>
            </div>
            <span class="discovery-item-badge">Use This IP</span>
          `;
          item.addEventListener('click', () => {
            document.getElementById('input-printer-ip').value = printer.ip;
            // Visual feedback
            item.style.borderColor = 'var(--accent-green)';
          });
          discoveryList.appendChild(item);
        });
      } else {
        discoveryStatus.className = 'discovery-status empty';
        discoveryStatus.textContent = 'No printers responded to UDP discovery. Check that your printer is powered on and connected to Wi-Fi.';
      }
    } catch (err) {
      discoveryStatus.className = 'discovery-status empty';
      discoveryStatus.textContent = `Scan notice: ${err.message}`;
    } finally {
      btnDiscover.disabled = false;
      btnDiscover.textContent = '🔍 Auto-Detect';
    }
  });
}

// Initialization on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  setupInputsAndPresets();
  setupActionButtons();
  setupSSE();

  // Load initial status
  pollStatus();
});
