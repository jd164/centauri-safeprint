const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * CentauriClient
 * Communicates with Elegoo Centauri Carbon 3D Printer using SDCP v3.0.0 over WebSocket
 */
class CentauriClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || '192.168.1.100';
    this.port = options.port || 3030;
    this.ws = null;
    this.mainboardID = '';
    this.attributes = null;
    this.status = null;
    this.connected = false;
    this.connecting = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pollTimer = null;
    this.videoUrl = null;

    // SDCP Commands
    this.CMD = {
      GET_PRINTER_STATUS: 0,
      GET_PRINTER_ATTR: 1,
      DISCONNECT: 64,
      START_PRINT: 128,
      SUSPEND_PRINT: 129,  // PAUSE
      STOP_PRINT: 130,     // STOP / CANCEL
      RESTORE_PRINT: 131,  // RESUME
      VIDEO_STREAM: 386,   // CAMERA
      PRINT_SPEED: 403
    };
  }

  setHost(host) {
    if (this.host !== host) {
      this.host = host;
      this.disconnect();
      this.connect();
    }
  }

  log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.emit('log', { timestamp, message: msg, type });
  }

  connect() {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    const url = `ws://${this.host}:${this.port}/websocket`;
    this.log(`Conectando à impressora em ${url}...`, 'info');

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connecting = false;
        this.connected = true;
        this.log(`Ligação estabelecida com sucesso com Centauri Carbon (${this.host})!`, 'success');
        this.emit('connected', { host: this.host });

        // Start heartbeat ping
        this.startHeartbeat();

        // Request initial attributes and status
        this.requestAttributes();
        this.requestStatus();

        // Start periodic status poll (every 3 seconds as backup to proactive updates)
        this.startStatusPolling();
      };

      this.ws.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : event.data.toString();
        if (text === 'pong' || text === 'ping') {
          return;
        }

        try {
          const msg = JSON.parse(text);
          this.handleMessage(msg);
        } catch (err) {
          // Non-JSON packet
        }
      };

      this.ws.onerror = (err) => {
        this.log(`Erro no WebSocket da impressora: ${err.message || 'Falha de ligação'}`, 'error');
        this.emit('error', err);
      };

      this.ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.connecting = false;
        this.stopHeartbeat();
        this.stopStatusPolling();

        if (wasConnected) {
          this.log(`Ligação com a impressora perdida. Tentando reconectar em 5 segundos...`, 'warning');
        }
        this.emit('disconnected');
        this.scheduleReconnect();
      };
    } catch (err) {
      this.connecting = false;
      this.connected = false;
      this.log(`Erro ao instanciar ligação WebSocket: ${err.message}`, 'error');
      this.scheduleReconnect();
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.stopStatusPolling();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send('ping');
        } catch (e) {}
      }
    }, 20000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  startStatusPolling() {
    this.stopStatusPolling();
    this.pollTimer = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === 1) {
        this.requestStatus();
      }
    }, 3000);
  }

  stopStatusPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  createPacket(cmd, data = {}) {
    const requestId = crypto.randomUUID().replace(/-/g, '');
    const packet = {
      Id: '',
      Data: {
        Cmd: cmd,
        Data: data,
        RequestID: requestId,
        MainboardID: this.mainboardID || '',
        TimeStamp: Math.floor(Date.now() / 1000),
        From: 1
      }
    };
    if (this.mainboardID) {
      packet.Topic = `sdcp/request/${this.mainboardID}`;
    }
    return JSON.stringify(packet);
  }

  send(cmd, data = {}) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) {
      this.log(`Não é possível enviar comando ${cmd}: Impressora não conectada`, 'warning');
      return false;
    }
    try {
      const packetStr = this.createPacket(cmd, data);
      this.ws.send(packetStr);
      return true;
    } catch (err) {
      this.log(`Erro ao enviar comando ${cmd}: ${err.message}`, 'error');
      return false;
    }
  }

  requestStatus() {
    return this.send(this.CMD.GET_PRINTER_STATUS);
  }

  requestAttributes() {
    return this.send(this.CMD.GET_PRINTER_ATTR);
  }

  pausePrint() {
    this.log('Comando enviado: PAUSAR IMPRESSÃO (Cmd 129)', 'warning');
    return this.send(this.CMD.SUSPEND_PRINT);
  }

  resumePrint() {
    this.log('Comando enviado: RETOMAR IMPRESSÃO (Cmd 131)', 'info');
    return this.send(this.CMD.RESTORE_PRINT);
  }

  stopPrint() {
    this.log('Comando enviado: PARAR / CANCELAR IMPRESSÃO (Cmd 130)', 'error');
    return this.send(this.CMD.STOP_PRINT);
  }

  requestCameraStream(enable = true) {
    this.log(`Comando enviado: ${enable ? 'Ativar' : 'Desativar'} Câmara (Cmd 386)`, 'info');
    return this.send(this.CMD.VIDEO_STREAM, { Enable: enable ? 1 : 0 });
  }

  handleMessage(msg) {
    // 1. Topic: sdcp/attributes/...
    if (msg.Attributes) {
      this.attributes = msg.Attributes;
      if (msg.Attributes.MainboardID) {
        this.mainboardID = msg.Attributes.MainboardID;
      }
      this.emit('attributes', this.attributes);
    }

    // 2. Topic: sdcp/status/...
    if (msg.Status) {
      this.status = msg.Status;
      this.emit('status', this.status);
    }

    // 3. Topic: sdcp/response/...
    if (msg.Data && typeof msg.Data.Cmd !== 'undefined') {
      const cmd = msg.Data.Cmd;
      const ack = msg.Data.Data ? msg.Data.Data.Ack : 0;
      this.emit('command_ack', { cmd, ack, data: msg.Data.Data });

      if (cmd === this.CMD.SUSPEND_PRINT) {
        if (ack === 0) {
          this.log('Impressora confirmou: PAUSA ATIVADA com sucesso.', 'success');
        } else {
          this.log(`Impressora retornou erro ao pausar (Ack: ${ack})`, 'error');
        }
      } else if (cmd === this.CMD.STOP_PRINT) {
        if (ack === 0) {
          this.log('Impressora confirmou: IMPRESSÃO PARADA com sucesso.', 'success');
        } else {
          this.log(`Impressora retornou erro ao parar (Ack: ${ack})`, 'error');
        }
      } else if (cmd === this.CMD.RESTORE_PRINT) {
        if (ack === 0) {
          this.log('Impressora confirmou: IMPRESSÃO RETOMADA com sucesso.', 'success');
        } else {
          this.log(`Impressora retornou erro ao retomar (Ack: ${ack})`, 'error');
        }
      } else if (cmd === this.CMD.VIDEO_STREAM) {
        if (msg.Data.Data && msg.Data.Data.VideoUrl) {
          let url = msg.Data.Data.VideoUrl;
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `http://${url}`;
          }
          this.videoUrl = url;
          this.emit('video_url', this.videoUrl);
          this.log(`Câmara disponível em: ${this.videoUrl}`, 'info');
        }
      }
    }
  }

  getSnapshot() {
    // Human readable print status text
    const printStatusNames = {
      0: 'Ocioso / Pronto',
      1: 'Homing (Origem)',
      2: 'Descendo',
      3: 'A Imprimir',
      4: 'Subindo',
      5: 'A Pausar...',
      6: 'Pausado',
      7: 'A Parar...',
      8: 'Parado',
      9: 'Concluído',
      10: 'A Verificar Ficheiro'
    };

    const printInfo = this.status?.PrintInfo || {};
    const printStatus = printInfo.Status ?? 0;
    const printStatusText = printStatusNames[printStatus] || `Estado ${printStatus}`;
    const isPrinting = printStatus === 3 || (this.status?.CurrentStatus?.includes(1) ?? false);
    const isPaused = printStatus === 6;

    return {
      connected: this.connected,
      connecting: this.connecting,
      host: this.host,
      mainboardID: this.mainboardID,
      machineName: this.attributes?.MachineName || 'Centauri Carbon',
      firmwareVersion: this.attributes?.FirmwareVersion || 'Desconhecida',
      protocolVersion: this.attributes?.ProtocolVersion || 'V3.0.0',
      printStatus,
      printStatusText,
      isPrinting,
      isPaused,
      filename: printInfo.Filename || '',
      progress: printInfo.Progress || 0,
      currentLayer: printInfo.CurrentLayer || 0,
      totalLayer: printInfo.TotalLayer || 0,
      currentTicks: printInfo.CurrentTicks || 0,
      totalTicks: printInfo.TotalTicks || 0,
      printSpeedPct: printInfo.PrintSpeedPct || 100,
      temperatures: {
        nozzle: Math.round((this.status?.TempOfNozzle || 0) * 10) / 10,
        nozzleTarget: Math.round((this.status?.TempTargetNozzle || 0) * 10) / 10,
        bed: Math.round((this.status?.TempOfHotbed || 0) * 10) / 10,
        bedTarget: Math.round((this.status?.TempTargetHotbed || 0) * 10) / 10,
        box: Math.round((this.status?.TempOfBox || 0) * 10) / 10
      },
      fans: {
        modelFan: this.status?.CurrentFanSpeed?.ModelFan || 0,
        auxiliaryFan: this.status?.CurrentFanSpeed?.AuxiliaryFan || 0,
        boxFan: this.status?.CurrentFanSpeed?.BoxFan || 0
      },
      videoUrl: this.videoUrl || `http://${this.host}:3031/video`
    };
  }
}

module.exports = CentauriClient;
