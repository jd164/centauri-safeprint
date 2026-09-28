const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const CentauriClient = require('./centauriClient');
const TimerManager = require('./timerManager');
const { discoverPrinters } = require('./printerDiscovery');

// Parse optional .env file if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {
    // Ignore .env read error
  }
}

// Read last known printer IP from local cache if available
const configPath = path.join(__dirname, '..', '.printer_config.json');
let savedIp = null;
if (fs.existsSync(configPath)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg && cfg.lastPrinterIp) {
      savedIp = cfg.lastPrinterIp;
    }
  } catch (e) {}
}

let PORT = parseInt(process.env.PORT, 10) || 3000;
let explicitIpProvided = false;
let PRINTER_IP = savedIp || '192.168.1.100';

if (process.env.PRINTER_IP) {
  PRINTER_IP = process.env.PRINTER_IP;
  explicitIpProvided = true;
}

// Support command-line arguments: --ip <ip>, -i <ip>, --port <port>, -p <port> or positional IP
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if ((arg === '--ip' || arg === '-i') && process.argv[i + 1]) {
    PRINTER_IP = process.argv[++i];
    explicitIpProvided = true;
  } else if ((arg === '--port' || arg === '-p') && process.argv[i + 1]) {
    PORT = parseInt(process.argv[++i], 10);
  } else if (!arg.startsWith('-') && !process.argv[i - 1]?.startsWith('-')) {
    PRINTER_IP = arg;
    explicitIpProvided = true;
  }
}

function saveLastPrinterIp(ip) {
  if (!ip || ip === '192.168.1.100') return;
  try {
    fs.writeFileSync(configPath, JSON.stringify({ lastPrinterIp: ip }, null, 2));
  } catch (e) {}
}

// Initialize printer client and timer manager
const printer = new CentauriClient({ host: PRINTER_IP });
const timer = new TimerManager(printer);

// Connect to Centauri Carbon immediately
printer.connect();

// Maintain SSE clients
const sseClients = new Set();

function broadcastEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Broadcast updates on timer and printer changes
timer.on('tick', () => {
  broadcastEvent('update', {
    timer: timer.getStatus(),
    printer: printer.getSnapshot()
  });
});

timer.on('state_change', (status) => {
  broadcastEvent('update', {
    timer: status,
    printer: printer.getSnapshot()
  });
});

timer.on('triggered', (data) => {
  broadcastEvent('triggered', data);
});

timer.on('warning', (data) => {
  broadcastEvent('warning', data);
});

timer.on('log', (logEntry) => {
  broadcastEvent('log', logEntry);
});

printer.on('status', () => {
  broadcastEvent('update', {
    timer: timer.getStatus(),
    printer: printer.getSnapshot()
  });
});

printer.on('connected', () => {
  saveLastPrinterIp(printer.host);
  broadcastEvent('update', {
    timer: timer.getStatus(),
    printer: printer.getSnapshot()
  });
});

printer.on('disconnected', () => {
  broadcastEvent('update', {
    timer: timer.getStatus(),
    printer: printer.getSnapshot()
  });
});

// Helper for JSON parsing from request body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API Endpoints ---

  // 1. Full status snapshot
  if (req.method === 'GET' && pathname === '/api/status') {
    sendJson(res, 200, {
      timer: timer.getStatus(),
      printer: printer.getSnapshot()
    });
    return;
  }

  // 2. Server-Sent Events (SSE)
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write('\n');

    // Send initial snapshot immediately
    res.write(`event: init\ndata: ${JSON.stringify({
      timer: timer.getStatus(),
      printer: printer.getSnapshot()
    })}\n\n`);

    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 3. Timer Start
  if (req.method === 'POST' && pathname === '/api/timer/start') {
    try {
      const data = await parseJsonBody(req);
      timer.start({
        seconds: data.seconds,
        action: data.action,
        targetLayer: data.targetLayer,
        targetProgress: data.targetProgress
      });
      sendJson(res, 200, { success: true, timer: timer.getStatus() });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 4. Timer Pause
  if (req.method === 'POST' && pathname === '/api/timer/pause') {
    const success = timer.pause();
    sendJson(res, 200, { success, timer: timer.getStatus() });
    return;
  }

  // 5. Timer Resume
  if (req.method === 'POST' && pathname === '/api/timer/resume') {
    const success = timer.resume();
    sendJson(res, 200, { success, timer: timer.getStatus() });
    return;
  }

  // 6. Timer Cancel
  if (req.method === 'POST' && pathname === '/api/timer/cancel') {
    const success = timer.cancel();
    sendJson(res, 200, { success, timer: timer.getStatus() });
    return;
  }

  // 7. Timer Adjust (+/- seconds)
  if (req.method === 'POST' && pathname === '/api/timer/adjust') {
    try {
      const data = await parseJsonBody(req);
      const success = timer.adjust(data.deltaSeconds);
      sendJson(res, 200, { success, timer: timer.getStatus() });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 8. Printer Pause Print (Cmd 129)
  if (req.method === 'POST' && pathname === '/api/printer/pause') {
    const success = printer.pausePrint();
    timer.addLog('Manual command triggered: PAUSE PRINT', 'warning');
    sendJson(res, 200, { success });
    return;
  }

  // 9. Printer Resume Print (Cmd 131)
  if (req.method === 'POST' && pathname === '/api/printer/resume') {
    const success = printer.resumePrint();
    timer.addLog('Manual command triggered: RESUME PRINT', 'info');
    sendJson(res, 200, { success });
    return;
  }

  // 10. Printer Stop Print (Cmd 130)
  if (req.method === 'POST' && pathname === '/api/printer/stop') {
    const success = printer.stopPrint();
    timer.addLog('Manual command triggered: STOP PRINT', 'error');
    sendJson(res, 200, { success });
    return;
  }

  // 11. Printer Camera Stream (Cmd 386)
  if (req.method === 'POST' && pathname === '/api/printer/camera') {
    try {
      const data = await parseJsonBody(req);
      const success = printer.requestCameraStream(data.enable !== false);
      sendJson(res, 200, { success });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 12. Reconnect / Update Printer IP
  if (req.method === 'POST' && pathname === '/api/printer/connect') {
    try {
      const data = await parseJsonBody(req);
      if (data.host) {
        saveLastPrinterIp(data.host);
        printer.setHost(data.host);
      } else {
        printer.disconnect();
        printer.connect();
      }
      sendJson(res, 200, { success: true, host: printer.host });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 13. Auto-Discovery of Printers
  if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/printer/discover') {
    try {
      let autoConnect = false;
      if (req.method === 'POST') {
        const body = await parseJsonBody(req).catch(() => ({}));
        autoConnect = Boolean(body.autoConnect);
      }
      const printers = await discoverPrinters({ timeoutMs: 2000 });
      if (printers.length > 0) {
        saveLastPrinterIp(printers[0].ip);
        if (autoConnect || !printer.isConnected) {
          printer.setHost(printers[0].ip);
        }
      }
      sendJson(res, 200, {
        success: true,
        count: printers.length,
        printers,
        connectedHost: printer.host
      });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // --- Static Files Serving from 'public/' ---
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  // Security check against directory traversal
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, '..', 'public', safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Centauri Carbon SafePrint (Anti-Runout Guard)`);
  console.log(` Web Dashboard: http://localhost:${PORT}`);
  console.log(` Initial Printer IP: ${printer.host}:${printer.port}`);
  console.log(` Official Printer Web UI: http://${printer.host}/network-device-manager/network/control`);
  console.log(`=======================================================`);

  // Background Auto-Discovery
  // If not already connected or explicit IP not specified, search local network
  setTimeout(async () => {
    if (!printer.isConnected) {
      console.log(`[Auto-Discovery] Scanning local network for Elegoo Centauri Carbon...`);
      try {
        const found = await discoverPrinters({ timeoutMs: 2500 });
        if (found.length > 0) {
          const target = found[0];
          console.log(`[Auto-Discovery] Found ${target.brand} ${target.name} at ${target.ip} (FW: ${target.firmwareVersion})!`);
          saveLastPrinterIp(target.ip);
          if (!explicitIpProvided || !printer.isConnected) {
            console.log(`[Auto-Discovery] Automatically connecting to ${target.ip}...`);
            printer.setHost(target.ip);
          }
        } else {
          console.log(`[Auto-Discovery] No printers responded to UDP discovery. Using current configured IP: ${printer.host}`);
        }
      } catch (e) {
        console.warn(`[Auto-Discovery] Scan notice:`, e.message);
      }
    }
  }, 1000);
});

// Periodic ping to keep SSE alive
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 15000);
