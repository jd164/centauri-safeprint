# Centauri SafePrint 🛡️

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Protocol: SDCP v3.0.0](https://img.shields.io/badge/Protocol-SDCP_v3.0.0-007ACC?logo=websocket&logoColor=white)](https://github.com/OpenCentauri/OpenCentauri)
[![Dependencies: 0](https://img.shields.io/badge/Dependencies-Zero-success)](#)
[![Printer: Elegoo Centauri Carbon](https://img.shields.io/badge/Hardware-Elegoo_Centauri_Carbon-orange)](#)

> **Smart Countdown Timer, Layer Guard & Anti-Runout Safety Manager**  
> Tailored specifically for the **Elegoo Centauri Carbon** 3D printer via native **SDCP v3.0.0** over WebSocket.

---

## 📋 Table of Contents

- [The Problem & The Solution](#-the-problem--the-solution)
- [Key Features](#-key-features)
- [Architecture & Protocol](#-architecture--protocol)
- [Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [Option A: Windows (Double-Click)](#option-a-windows-double-click)
  - [Option B: macOS & Linux](#option-b-macos--linux)
  - [Option C: Command Line / NPM](#option-c-command-line--npm)
- [Configuring Printer IP](#-configuring-printer-ip)
- [How to Use the SafePrint Dashboard](#-how-to-use-the-safeprint-dashboard)
- [SDCP Protocol Reference](#-sdcp-protocol-reference)
- [Troubleshooting](#-troubleshooting)
- [Contributing & License](#-contributing--license)

---

## 💡 The Problem & The Solution

### The Challenge
When 3D printing with spool ends, partial spools, or materials without a reliable physical runout sensor, you risk having the filament run out mid-job. When that happens, the printer continues moving in thin air for hours—ruining the print, wasting energy, and potentially baking heat into the nozzle.

### The Solution
**Centauri SafePrint** connects directly to your Elegoo Centauri Carbon over your local network using Elegoo's native **SDCP v3.0.0 (Smart Device Control Protocol)**. 

When your programmed timer runs out—or when your target layer or progress threshold is reached—SafePrint sends the official printer suspend command:
- ⏸️ **Safe Toolhead Parking**: The nozzle lifts and parks away from the model.
- 🔥 **Thermal Preservation**: The heated bed and nozzle stay at their target temperatures so the print adheres firmly to the build plate.
- 🧵 **Seamless Spool Swap**: Swap to a new spool, purge, and resume printing with zero lost progress!

---

## ✨ Key Features

- **⏱️ Robust Server-Side Countdown Engine**:
  - The timer runs in the local Node.js backend—not solely in the browser. You can close tabs, lock your computer screen, or switch devices; the countdown continues reliably and executes the pause command right on time.
  - Quick presets: `5 min`, `15 min`, `30 min`, `45 min`, `1h`, `2h`, `3h`.
  - On-the-fly adjustment buttons: `+1 min`, `+5 min`, `+10 min`, `+30 min` while the timer is actively counting.
  - Pause, resume, or abort the timer at any time.

- **🎯 Smart Triggers (Layer & Percentage Guard)**:
  - **Stop at Target Layer**: Know your spool will only last until layer ~180? Enter `180`. SafePrint monitors live SDCP telemetry and triggers pause as soon as that layer starts.
  - **Stop at Progress %**: Trigger automatic pause upon reaching a specific completion percentage.

- **📊 Real-Time Printer Telemetry**:
  - Live machine status (Idle, Printing, Paused, Homing, etc.).
  - Active file name and job completion progress.
  - Current layer vs. total layer count.
  - Elapsed print time and estimated remaining time.
  - Live temperatures with animated visual meters for **Nozzle**, **Heated Bed**, and **Chamber Box**.
  - Live fan speed indicators (**Model Fan**, **Auxiliary Fan**, **Box Exhaust Fan**).

- **📹 Live MJPEG Camera Feed**:
  - Integrated live stream viewer connecting to the Centauri Carbon's camera stream (`http://<PRINTER_IP>:3031/video`).
  - Toggle stream on/off with one click (`Cmd 386`).

- **🔔 Synthesized Web Audio Alarms & Desktop Notifications**:
  - Early warning chime at 1 minute remaining to get your new spool ready.
  - Distinct trigger alarm when pause/stop action is executed.
  - Native OS desktop notifications for background awareness.

- **⚡ Zero External Dependencies**:
  - Built with pure Node.js standard library modules (`http`, `events`, `crypto`, `fs`, `path`) and native WebSockets (`WebSocket`).
  - No `node_modules` installation required! Download and run immediately.

- **📱 Fully Responsive Dark-Mode Dashboard**:
  - Sleek glassmorphism UI designed for monitors, tablets, and smartphones on your local Wi-Fi (`http://<YOUR_PC_IP>:3000`).

---

## 🏗️ Architecture & Protocol

```
┌─────────────────────────────────┐
│     Browser / Mobile Device     │
│   (HTML5, Vanilla CSS, JS)      │
└──────────────┬──────────────────┘
               │  HTTP & Server-Sent Events (SSE)
               ▼
┌─────────────────────────────────┐
│     SafePrint Node.js Server    │
│  - Persistent Timer Engine      │
│  - Telemetry Broadcaster        │
└──────────────┬──────────────────┘
               │  WebSocket (SDCP v3.0.0 JSON-RPC)
               ▼
┌────────────────────────────────────────────────────────┐
│             Elegoo Centauri Carbon 3D Printer          │
│  Port 3030: SDCP WebSocket (ws://<IP>:3030/websocket)   │
│  Port 3031: MJPEG Video Stream (http://<IP>:3031/video)│
│  Port 80:   OEM Web Control Manager                    │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) version **18.0.0** or higher installed.
- Your computer and Elegoo Centauri Carbon connected to the same local network (LAN / Wi-Fi).

---

### Option A: Windows (Double-Click)

1. [Download this repository](https://github.com/jd164/centauri-safeprint/archive/refs/heads/main.zip) as a ZIP file and extract it (or clone it with git).
2. Double-click:
   ```text
   start.bat
   ```
3. Your browser will automatically open to `http://localhost:3000`.

---

### Option B: macOS & Linux

1. Clone or download the repository.
2. In your terminal, make the script executable and run:
   ```bash
   chmod +x start.sh
   ./start.sh
   ```
3. Open `http://localhost:3000` in your web browser.

---

### Option C: Command Line / NPM

```bash
# Clone the repository
git clone https://github.com/jd164/centauri-safeprint.git
cd centauri-safeprint

# Start the server (Zero install needed!)
npm start
```

Or pass your printer IP directly as a command-line argument:
```bash
# Direct IP as positional argument
node src/server.js 192.168.1.150

# Using flags
node src/server.js --ip 192.168.1.150 --port 3000
```

---

## ⚙️ Configuring Printer IP

Find your printer's local IP address on the Centauri Carbon touchscreen under:  
**Settings ➔ Network / Wi-Fi** (e.g. `192.168.1.120`).

You have three convenient ways to set it:

### 1. In the Web Interface (Easiest)
1. Open the dashboard at `http://localhost:3000`.
2. Click the gear icon in the top right navbar (`⚙️ IP`).
3. Enter your printer's IP and click **Guardar & Reconectar** (*Save & Reconnect*).

### 2. Via `.env` File
Copy the example file and edit `PRINTER_IP`:
```bash
cp .env.example .env
```
Contents of `.env`:
```env
PRINTER_IP=192.168.1.120
PORT=3000
```

### 3. Via CLI Parameter
```bash
node src/server.js 192.168.1.120
```

---

## 🎮 How to Use the SafePrint Dashboard

1. **Check Connection**:
   - The top banner will display **Centauri Ligada (Connected)** with a green pulse once connected to the printer via WebSocket.
2. **Choose Action**:
   - ⏸️ **Pausar Impressão (Recommended)**: Suspends printing safely, parks the nozzle, keeps temperatures on, and awaits a new spool.
   - ⏹️ **Parar / Cancelar**: Completely stops the job.
3. **Set Your Target**:
   - **By Time**: Choose a quick preset (e.g. `45 min`) or enter a custom duration in hours and minutes, then click **Iniciar Temporizador**.
   - **By Layer**: Switch to the **Camada (Layer)** tab and enter the target layer number (e.g. `120`).
   - **By Percentage**: Switch to the **Percentagem (%)** tab and choose target percent.
4. **Monitor**:
   - Watch the countdown circle, telemetry bars, and live logs. Use the `+1m`, `+5m`, `+10m` buttons anytime to extend the timer if your spool has extra filament.
5. **Resume**:
   - Once paused and your new spool is loaded, click **Retomar Agora** on the dashboard or directly on the printer screen.

---

## 🔍 SDCP Protocol Reference

The **Elegoo Centauri Carbon** communicates using the **Smart Device Control Protocol (SDCP) v3.0.0**:

- **WebSocket URL**: `ws://<PRINTER_IP>:3030/websocket`
- **Heartbeat**: Ping / Pong text frame every 20 seconds.
- **Mainboard ID**: Automatically discovered from incoming attribute/status packets.

### Commands Used by SafePrint:

| Command ID | Constant | Description |
|:---:|:---|:---|
| `0` | `GET_PRINTER_STATUS` | Queries current telemetry, layer info, temps, and printing status |
| `1` | `GET_PRINTER_ATTR` | Queries printer attributes and hardware MainboardID |
| `129` | `SUSPEND_PRINT` | **Pause / Suspend** current print job |
| `130` | `STOP_PRINT` | **Stop / Cancel** current print job |
| `131` | `RESTORE_PRINT` | **Resume** a paused print job |
| `386` | `VIDEO_STREAM` | Enables/disables the onboard MJPEG video stream on port 3031 |

### SDCP Request Packet Format:
```json
{
  "Id": "",
  "Data": {
    "Cmd": 129,
    "Data": {},
    "RequestID": "c2005a76e273413ea022f3e8b0932026",
    "MainboardID": "your_mainboard_id_here",
    "TimeStamp": 1759060000,
    "From": 1
  },
  "Topic": "sdcp/request/your_mainboard_id_here"
}
```

---

## 🛠️ Troubleshooting

- **Status shows "Desconectada" (Disconnected)**:
  - Verify that the Centauri Carbon is powered on and connected to the same Wi-Fi network.
  - Double check the IP address on the printer screen under *Settings > Network*.
  - Test if the printer web page opens in your browser at `http://<PRINTER_IP>`.
- **Camera feed is blank or black**:
  - The Centauri Carbon camera stream must be started. Click the camera toggle button on the dashboard to send `Cmd 386`.
  - Ensure port 3031 is not blocked by local firewalls.
- **Node.js error on start**:
  - Ensure Node.js is version 18.0.0 or higher: `node -v`.
  - Native `WebSocket` support is built into Node.js 18+ (stable and standard in Node 20/22+).

---

## 📄 License & Credits

- Distributed under the **MIT License**. See [`LICENSE`](./LICENSE) for more details.
- Protocol insights inspired by the open-source community at [OpenCentauri](https://github.com/OpenCentauri/OpenCentauri).
- Created for the 3D printing community to save prints, time, and filament. 🚀
