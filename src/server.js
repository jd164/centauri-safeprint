const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const CentauriClient = require('./centauriClient');
const TimerManager = require('./timerManager');

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

let PORT = parseInt(process.env.PORT, 10) || 3000;
let PRINTER_IP = process.env.PRINTER_IP || '192.168.1.100';

// Support command-line arguments: --ip <ip>, -i <ip>, --port <port>, -p <port> or positional IP
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if ((arg === '--ip' || arg === '-i') && process.argv[i + 1]) {
    PRINTER_IP = process.argv[++i];
  } else if ((arg === '--port' || arg === '-p') && process.argv[i + 1]) {
    PORT = parseInt(process.argv[++i], 10);
  } else if (!arg.startsWith('-') && !process.argv[i - 1]?.startsWith('-')) {
    PRINTER_IP = arg;
  }
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
    timer.addLog('Comando manual acionado: PAUSAR IMPRESSÃO', 'warning');
    sendJson(res, 200, { success });
    return;
  }

  // 9. Printer Resume Print (Cmd 131)
  if (req.method === 'POST' && pathname === '/api/printer/resume') {
    const success = printer.resumePrint();
    timer.addLog('Comando manual acionado: RETOMAR IMPRESSÃO', 'info');
    sendJson(res, 200, { success });
    return;
  }

  // 10. Printer Stop Print (Cmd 130)
  if (req.method === 'POST' && pathname === '/api/printer/stop') {
    const success = printer.stopPrint();
    timer.addLog('Comando manual acionado: PARAR IMPRESSÃO', 'error');
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
  console.log(` Centauri Carbon SafePrint (Proteção Anti-Runout)`);
  console.log(` Servidor ativo em: http://localhost:${PORT}`);
  console.log(` Impressora configurada em: ${printer.host}:${printer.port}`);
  console.log(` Link original da impressora: http://${printer.host}/network-device-manager/network/control`);
  console.log(`=======================================================`);
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
