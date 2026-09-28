const EventEmitter = require('events');

/**
 * TimerManager
 * Server-side countdown timer for Elegoo Centauri Carbon runout protection.
 * Runs independently of client browsers.
 */
class TimerManager extends EventEmitter {
  constructor(centauriClient) {
    super();
    this.client = centauriClient;
    this.active = false;
    this.paused = false;
    this.totalSeconds = 0;
    this.remainingSeconds = 0;
    this.startTime = null;
    this.endTime = null;
    this.action = 'pause'; // 'pause' (Cmd 129) or 'stop' (Cmd 130)
    this.targetLayer = null;
    this.targetProgress = null;
    this.triggered = false;
    this.triggerReason = null;
    this.interval = null;
    this.logs = [];

    // Pre-populate with initial log
    this.addLog('Sistema de proteção anti-runout inicializado.', 'info');

    // Listen to printer status to check target layer/progress
    this.client.on('status', () => {
      this.checkAlternativeTriggers();
    });

    this.client.on('log', (logEntry) => {
      this.addLog(logEntry.message, logEntry.type);
    });
  }

  addLog(message, type = 'info') {
    const entry = {
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      time: new Date().toLocaleTimeString('pt-PT'),
      message,
      type
    };
    this.logs.unshift(entry);
    if (this.logs.length > 50) {
      this.logs.pop();
    }
    this.emit('log', entry);
  }

  start({ seconds, action = 'pause', targetLayer = null, targetProgress = null }) {
    this.cancel(); // Cancel any existing timer

    const parsedSeconds = Math.max(1, parseInt(seconds, 10) || 0);
    this.active = true;
    this.paused = false;
    this.totalSeconds = parsedSeconds;
    this.remainingSeconds = parsedSeconds;
    this.startTime = Date.now();
    this.endTime = this.startTime + (parsedSeconds * 1000);
    this.action = action === 'stop' ? 'stop' : 'pause';
    this.targetLayer = targetLayer ? parseInt(targetLayer, 10) : null;
    this.targetProgress = targetProgress ? parseFloat(targetProgress) : null;
    this.triggered = false;
    this.triggerReason = null;

    const actionText = this.action === 'stop' ? 'PARAR IMPRESSÃO' : 'PAUSAR IMPRESSÃO';
    const timeFormatted = this.formatTime(parsedSeconds);

    let desc = `Temporizador INICIADO: ${timeFormatted} para ${actionText}.`;
    if (this.targetLayer) desc += ` (Ou ao atingir camada ${this.targetLayer})`;
    if (this.targetProgress) desc += ` (Ou ao atingir ${this.targetProgress}%)`;

    this.addLog(desc, 'success');
    this.emit('state_change', this.getStatus());

    this.interval = setInterval(() => this.tick(), 1000);
  }

  tick() {
    if (!this.active || this.paused) return;

    this.remainingSeconds--;

    if (this.remainingSeconds <= 0) {
      this.remainingSeconds = 0;
      this.executeTrigger('Tempo esgotado');
      return;
    }

    // 1-minute warning notification
    if (this.remainingSeconds === 60) {
      this.addLog('AVISO: Falta apenas 1 minuto para o acionamento do temporizador!', 'warning');
      this.emit('warning', { secondsLeft: 60 });
    }

    this.emit('tick', this.getStatus());
  }

  checkAlternativeTriggers() {
    if (!this.active || this.paused || this.triggered) return;

    const snap = this.client.getSnapshot();

    // Check target layer
    if (this.targetLayer && snap.currentLayer >= this.targetLayer) {
      this.executeTrigger(`Camada alvo (${this.targetLayer}) atingida`);
      return;
    }

    // Check target progress percentage
    if (this.targetProgress && snap.progress >= this.targetProgress) {
      this.executeTrigger(`Progresso alvo (${this.targetProgress}%) atingido`);
      return;
    }
  }

  executeTrigger(reason) {
    if (this.triggered) return;
    this.triggered = true;
    this.triggerReason = reason;

    const actionName = this.action === 'stop' ? 'PARAR' : 'PAUSAR';
    this.addLog(`TEMPORIZADOR ACIONADO (${reason})! Executando comando: ${actionName}...`, 'warning');

    if (this.action === 'stop') {
      this.client.stopPrint();
    } else {
      this.client.pausePrint();
    }

    this.emit('triggered', {
      action: this.action,
      reason,
      time: new Date().toLocaleTimeString('pt-PT')
    });

    this.stopInterval();
    this.active = false;
    this.emit('state_change', this.getStatus());
  }

  pause() {
    if (!this.active || this.paused) return false;
    this.paused = true;
    this.addLog('Temporizador em PAUSA.', 'info');
    this.emit('state_change', this.getStatus());
    return true;
  }

  resume() {
    if (!this.active || !this.paused) return false;
    this.paused = false;
    this.endTime = Date.now() + (this.remainingSeconds * 1000);
    this.addLog('Temporizador RETOMADO.', 'info');
    this.emit('state_change', this.getStatus());
    return true;
  }

  cancel() {
    if (!this.active && !this.interval) return false;
    this.stopInterval();
    const wasActive = this.active;
    this.active = false;
    this.paused = false;
    this.remainingSeconds = 0;
    this.triggered = false;
    this.triggerReason = null;

    if (wasActive) {
      this.addLog('Temporizador CANCELADO manualmente.', 'warning');
    }
    this.emit('state_change', this.getStatus());
    return true;
  }

  adjust(deltaSeconds) {
    if (!this.active) return false;
    const delta = parseInt(deltaSeconds, 10);
    if (isNaN(delta) || delta === 0) return false;

    this.remainingSeconds = Math.max(1, this.remainingSeconds + delta);
    this.totalSeconds = Math.max(this.totalSeconds, this.remainingSeconds);
    this.endTime = Date.now() + (this.remainingSeconds * 1000);

    const sign = delta > 0 ? '+' : '';
    const minutes = Math.round(delta / 60);
    this.addLog(`Tempo ajustado em ${sign}${minutes} min. Restam: ${this.formatTime(this.remainingSeconds)}`, 'info');
    this.emit('state_change', this.getStatus());
    return true;
  }

  stopInterval() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }

  getStatus() {
    return {
      active: this.active,
      paused: this.paused,
      totalSeconds: this.totalSeconds,
      remainingSeconds: this.remainingSeconds,
      progressPercent: this.totalSeconds > 0 
        ? Math.round(((this.totalSeconds - this.remainingSeconds) / this.totalSeconds) * 100) 
        : 0,
      formattedRemaining: this.formatTime(this.remainingSeconds),
      action: this.action,
      targetLayer: this.targetLayer,
      targetProgress: this.targetProgress,
      triggered: this.triggered,
      triggerReason: this.triggerReason,
      endTime: this.endTime,
      logs: this.logs
    };
  }
}

module.exports = TimerManager;
