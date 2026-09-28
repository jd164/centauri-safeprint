const dgram = require('dgram');
const os = require('os');

/**
 * Discovers Elegoo Centauri Carbon printers on the local network via SDCP UDP broadcast / subnet scan (M99999).
 * Uses native Node.js 'dgram' and 'os' modules with zero external dependencies.
 */
function discoverPrinters({ timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const discovered = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        socket.close();
      } catch (e) {}
      resolve(Array.from(discovered.values()));
    };

    socket.on('error', (err) => {
      // Clean up gracefully on socket errors (e.g. port access issues)
      cleanup();
    });

    socket.on('message', (msg, rinfo) => {
      try {
        const text = msg.toString();
        const json = JSON.parse(text);
        if (json && json.Data) {
          const printerInfo = {
            ip: json.Data.MainboardIP || rinfo.address,
            name: json.Data.Name || json.Data.MachineName || 'Centauri Carbon',
            brand: json.Data.BrandName || 'ELEGOO',
            machineName: json.Data.MachineName || 'Centauri Carbon',
            mainboardId: json.Data.MainboardID || '',
            protocolVersion: json.Data.ProtocolVersion || 'V3.0.0',
            firmwareVersion: json.Data.FirmwareVersion || ''
          };
          discovered.set(printerInfo.ip, printerInfo);
        }
      } catch (e) {
        // Ignore malformed packets from other network devices
      }
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch (e) {}

      const msg = Buffer.from('M99999');

      // 1. Send to global broadcast
      try {
        socket.send(msg, 0, msg.length, 3000, '255.255.255.255');
      } catch (e) {}

      // 2. Discover local interfaces and send to subnet broadcast + all subnet IPs
      try {
        const ifaces = os.networkInterfaces();
        for (const name of Object.keys(ifaces)) {
          for (const net of ifaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
              const parts = net.address.split('.');
              if (parts.length === 4) {
                const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
                // Subnet broadcast
                socket.send(msg, 0, msg.length, 3000, `${prefix}.255`);
                // Direct probe to each host in subnet (fast 6-byte UDP packet)
                for (let i = 1; i <= 254; i++) {
                  socket.send(msg, 0, msg.length, 3000, `${prefix}.${i}`);
                }
              }
            }
          }
        }
      } catch (e) {}
    });

    timer = setTimeout(cleanup, timeoutMs);
  });
}

module.exports = { discoverPrinters };
