const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fork } = require('node:child_process');
const { DEFAULT_CONFIG } = require('./collector');
const { TunnelManager, DEFAULT_TUNNEL_CONFIG } = require('./tunnelManager');
const syntheticDb = require('./syntheticDb');

function parseDotEnv(content) {
  const out = {};
  String(content || '').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i < 1) return;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  });
  return out;
}

function readEnvConfig() {
  // In packaged app .env is placed in resourcesPath via extraResources.
  // In dev mode fall back to process.cwd().
  const envCandidates = [
    process.resourcesPath && path.join(process.resourcesPath, '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env'),
  ].filter(Boolean);
  let parsed = {};
  for (const envPath of envCandidates) {
    try {
      if (fs.existsSync(envPath)) {
        parsed = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
        break;
      }
    } catch (_) {}
  }

  const pickNum = (k, d) => {
    const raw = process.env[k] ?? parsed[k];
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : d;
  };

  const pickBool = (k, d) => {
    const rawValue = process.env[k] ?? parsed[k];
    if (rawValue === undefined || rawValue === null || rawValue === '') return Boolean(d);
    const raw = String(rawValue).trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes') return true;
    if (raw === '0' || raw === 'false' || raw === 'no') return false;
    return Boolean(d);
  };

  return {
    apiBase: process.env.API_BASE || parsed.API_BASE || 'http://127.0.0.1:13000/api',
    maxHandover: pickNum('MAX_HANDOVER', 1200),
    maxCollisions: pickNum('MAX_COLLISIONS', 1200),
    maxBs: pickNum('MAX_BS', 600),
    defaultRangeStart: process.env.DEFAULT_RANGE_START || parsed.DEFAULT_RANGE_START || '2025-06-14T08:00:00Z',
    defaultRangeEnd: process.env.DEFAULT_RANGE_END || parsed.DEFAULT_RANGE_END || '2025-06-14T10:09:07Z',
    resetLogsOnStart: pickBool('RESET_LOGS_ON_START', true),
    autoStartTunnel: pickBool('AUTO_START_TUNNEL', true),
    useSyntheticDb: pickBool('USE_SYNTHETIC_DB', false),
    tunnelDefaults: {
      host: process.env.SSH_HOST || parsed.SSH_HOST || DEFAULT_TUNNEL_CONFIG.host,
      user: process.env.SSH_USER || parsed.SSH_USER || DEFAULT_TUNNEL_CONFIG.user,
      port: pickNum('SSH_PORT', DEFAULT_TUNNEL_CONFIG.port),
      password: process.env.SSH_PASSWORD || parsed.SSH_PASSWORD || DEFAULT_TUNNEL_CONFIG.password,
      strictHostKeyChecking: pickBool('SSH_STRICT_HOST_KEY_CHECKING', DEFAULT_TUNNEL_CONFIG.strictHostKeyChecking),
      forwards: DEFAULT_TUNNEL_CONFIG.forwards
    }
  };
}

class CollectorProcessClient {
  constructor(onSnapshot) {
    this.onSnapshot = onSnapshot;
    this.proc = null;
    this.reqId = 1;
    this.pending = new Map();
    this.lastSnapshot = null;
  }

  start() {
    if (this.proc && !this.proc.killed) return;
    this.proc = fork(path.join(__dirname, 'collectorProcess.js'), [], {
      cwd: process.cwd(),
      silent: true
    });

    this.proc.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'snapshot') {
        this.lastSnapshot = msg.data || null;
        if (typeof this.onSnapshot === 'function') this.onSnapshot(this.lastSnapshot);
        return;
      }
      if (msg.type === 'reply') {
        const slot = this.pending.get(msg.reqId);
        if (!slot) return;
        this.pending.delete(msg.reqId);
        if (msg.ok) slot.resolve(msg.data); else slot.reject(new Error(String(msg.data || 'Unknown collector error')));
      }
    });

    this.proc.on('exit', () => {
      this.proc = null;
      for (const [, slot] of this.pending.entries()) slot.reject(new Error('collector process exited'));
      this.pending.clear();
    });

    this.proc.stdout?.on('data', (chunk) => appendObserverLog('collector:stdout', { text: String(chunk) }));
    this.proc.stderr?.on('data', (chunk) => appendObserverLog('collector:stderr', { text: String(chunk) }));
  }

  stop() {
    if (!this.proc) return;
    try {
      this.send('stop').catch(() => {});
      this.proc.kill('SIGTERM');
    } catch (_) {}
    this.proc = null;
  }

  send(type, payload) {
    this.start();
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.killed) {
        reject(new Error('collector process is unavailable'));
        return;
      }
      const reqId = this.reqId += 1;
      this.pending.set(reqId, { resolve, reject });
      this.proc.send({ type, payload, reqId });
      setTimeout(() => {
        const slot = this.pending.get(reqId);
        if (!slot) return;
        this.pending.delete(reqId);
        reject(new Error(`collector timeout for ${type}`));
      }, 12000);
    });
  }

  async getConfig() {
    return this.send('getConfig');
  }

  async setConfig(nextConfig) {
    return this.send('setConfig', nextConfig || {});
  }

  async getLastSnapshot() {
    if (this.lastSnapshot) return this.lastSnapshot;
    return this.send('getLast');
  }
}

let mainWindow = null;
// logsDir is set after app is ready; TunnelManager is created lazily
let logsDir = path.join(process.cwd(), 'logs');
const tunnelManager = new TunnelManager(logsDir);
const collectorClient = new CollectorProcessClient((snapshot) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('snapshot:update', snapshot);
  }
});
let tunnelConfigPath = null;
let runtimeEnvConfig = readEnvConfig();

const BACKEND_LOG_TARGETS = {
  gateway: { ns: 'backend-go-svc-gateway', podLike: 'svc-gateway' },
  datafilter: { ns: 'backend-go-svc-datafilter', podLike: 'svc-datafilter-v1' },
  websocket: { ns: 'backend-go-svc-websocket', podLike: 'srv-websocket' },
  auth: { ns: 'backend-go-svc-auth', podLike: 'svc-auth-v1' }
};

function appendObserverLog(event, data) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), event, data });
    fs.appendFileSync(path.join(logsDir, 'observer.log'), `${line}\n`);
  } catch (_) {}
}

function loadTunnelConfig() {
  try {
    if (tunnelConfigPath && fs.existsSync(tunnelConfigPath)) {
      const raw = JSON.parse(fs.readFileSync(tunnelConfigPath, 'utf8'));
      tunnelManager.setConfig(raw || {});
    }
  } catch (_) {}
}

function saveTunnelConfig() {
  try {
    if (!tunnelConfigPath) return;
    fs.mkdirSync(path.dirname(tunnelConfigPath), { recursive: true });
    fs.writeFileSync(tunnelConfigPath, JSON.stringify(tunnelManager.getRawConfig(), null, 2));
  } catch (_) {}
}

function resetRunLogs() {
  if (!runtimeEnvConfig.resetLogsOnStart) return;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'observer.log'), '');
    fs.writeFileSync(path.join(logsDir, 'ssh-tunnel.out'), '');
  } catch (_) {}
}

function setupTileHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://tile.openstreetmap.org/*'] },
    (details, callback) => {
      details.requestHeaders = details.requestHeaders || {};
      details.requestHeaders.Referer = 'https://localhost/';
      details.requestHeaders['User-Agent'] =
        details.requestHeaders['User-Agent'] ||
        'RadioBackendObserver/0.1 (+desktop app; read-only observer)';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    title: 'Radio Backend Observer',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  collectorClient.start();

  if (runtimeEnvConfig.autoStartTunnel) {
    const cfg = tunnelManager.getRawConfig();
    if (cfg.password) {
      tunnelManager.start().catch((e) => {
        appendObserverLog('tunnel:autoStart:error', { message: String(e?.message || e) });
      });
    }
  }
}

function runSshCommand(remoteCmd) {
  return tunnelManager.exec(remoteCmd);
}

function isoSqlSafe(v) {
  return String(v || '').replace(/[^0-9T:\-+.Z ]/g, '');
}

async function getRadioPointsFromDb(startIso, endIso, limit = 20000) {
  const start = isoSqlSafe(startIso);
  const end = isoSqlSafe(endIso);
  const lim = Math.max(100, Math.min(80000, Number(limit || 20000)));

  const remote = [
    '. $HOME/.profile 2>/dev/null || true',
    '. $HOME/.bashrc 2>/dev/null || true',
    'set -e',
    "PASS=$(kubectl -n storage-pg get secret postgres-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)",
    "POD=$(kubectl -n storage-pg get pod -o name | grep '^pod/postgres-0' | head -n1)",
    `kubectl -n storage-pg exec "$POD" -- env PGPASSWORD="$PASS" psql -U postgres -d thermal_map_data_legacy -At -F '|' -c "select to_char(m.time at time zone 'UTC','YYYY-MM-DD\\"T\\"HH24:MI:SS.MS\\"Z\\"'), m.latitude, m.longitude, l.rsrp, l.rsrq, l.rssnr, l.ci, l.pci, l.mnc, l.cqi, l.bandwidth from message2 m join lte_data l on l.request_id = m.id where m.time between '${start}' and '${end}' and m.latitude is not null and m.longitude is not null and l.rsrp is not null order by m.time desc limit ${lim};"`
  ].join('; ');

  const raw = await runSshCommand(remote);
  return String(raw || '').split('\n').filter(Boolean).map((line) => {
    const p = line.split('|');
    return {
      time: p[0] || '',
      latitude: Number(p[1]),
      longitude: Number(p[2]),
      rsrp: Number(p[3]),
      rsrq: Number(p[4]),
      rssnr: Number(p[5]),
      cell_id: p[6] || '',
      phys_cell_id: p[7] || '',
      mnc: p[8] || '',
      cqi: p[9] || '',
      bandwidth: p[10] || ''
    };
  }).filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
}

async function getBackendLogs(service, tailLines = 250) {
  const t = BACKEND_LOG_TARGETS[service] || BACKEND_LOG_TARGETS.datafilter;
  const lines = Math.max(20, Math.min(5000, Number(tailLines || 250)));
  const cmd = [
    '. $HOME/.profile 2>/dev/null || true',
    '. $HOME/.bashrc 2>/dev/null || true',
    'set -e',
    `NS='${t.ns}'`,
    `LIKE='${t.podLike}'`,
    "POD=$(kubectl -n \"$NS\" get pods -o name | grep \"$LIKE\" | head -n 1 || true)",
    "if [ -z \"$POD\" ]; then POD=$(kubectl -n \"$NS\" get pods -o name | head -n 1 || true); fi",
    "if [ -z \"$POD\" ]; then echo \"ERROR: no pods found in namespace $NS\"; exit 0; fi",
    `kubectl -n "$NS" logs "$POD" --tail=${lines} --all-containers=true 2>&1 || true`
  ].join('; ');
  const out = await runSshCommand(cmd);
  return String(out || '').trim() || `No logs from namespace ${t.ns}`;
}

async function getRadioMetaFromDb() {
  const remote = [
    '. $HOME/.profile 2>/dev/null || true',
    '. $HOME/.bashrc 2>/dev/null || true',
    'set -e',
    "PASS=$(kubectl -n storage-pg get secret postgres-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)",
    "POD=$(kubectl -n storage-pg get pod -o name | grep '^pod/postgres-0' | head -n1)",
    "kubectl -n storage-pg exec \"$POD\" -- env PGPASSWORD=\"$PASS\" psql -U postgres -d thermal_map_data_legacy -At -F '|' -c \"select to_char(min(m.time at time zone 'UTC'),'YYYY-MM-DD\\\"T\\\"HH24:MI:SS\\\"Z\\\"'), to_char(max(m.time at time zone 'UTC'),'YYYY-MM-DD\\\"T\\\"HH24:MI:SS\\\"Z\\\"'), count(*) from message2 m join lte_data l on l.request_id = m.id where m.latitude is not null and m.longitude is not null and l.rsrp is not null;\""
  ].join('; ');

  const output = await runSshCommand(remote);
  const raw = String(output || '').split('\n').find((line) => line.includes('|')) || '';
  const p = raw.split('|');
  return {
    minIso: p[0] || '',
    maxIso: p[1] || '',
    count: Number(p[2] || 0)
  };
}

app.whenReady().then(() => {
  if (app.dock) {
    app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));
  }
  tunnelConfigPath = path.join(app.getPath('userData'), 'tunnel.config.json');
  logsDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'logs')
    : path.join(process.cwd(), 'logs');
  tunnelManager.setLogsDir(logsDir);
  runtimeEnvConfig = readEnvConfig();
  resetRunLogs();
  tunnelManager.setConfig(runtimeEnvConfig.tunnelDefaults);
  loadTunnelConfig();
  setupTileHeaders();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  collectorClient.stop();
  tunnelManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('snapshot:getLast', async () => {
  try {
    return await collectorClient.getLastSnapshot();
  } catch (_) {
    return null;
  }
});

ipcMain.handle('config:get', async () => {
  try {
    return await collectorClient.getConfig();
  } catch (_) {
    return DEFAULT_CONFIG;
  }
});

ipcMain.handle('config:set', async (_event, nextConfig) => {
  try {
    return await collectorClient.setConfig(nextConfig || {});
  } catch (_) {
    return DEFAULT_CONFIG;
  }
});

ipcMain.handle('tunnel:get', () => tunnelManager.getStatus());
ipcMain.handle('tunnel:set', (_event, cfg) => {
  const st = tunnelManager.setConfig(cfg || {});
  saveTunnelConfig();
  return st;
});
ipcMain.handle('tunnel:start', async () => {
  try {
    return await tunnelManager.start();
  } catch (e) {
    return { error: String(e.message || e), running: false };
  }
});
ipcMain.handle('tunnel:stop', () => tunnelManager.stop());
ipcMain.handle('tunnel:defaults', () => DEFAULT_TUNNEL_CONFIG);

ipcMain.handle('logs:tail', (_event, payload) => {
  const file = payload?.file || 'observer';
  const lines = Number(payload?.lines || 200);
  const map = {
    observer: path.join(logsDir, 'observer.log'),
    tunnel: path.join(logsDir, 'ssh-tunnel.out')
  };
  const target = map[file] || map.observer;
  if (!fs.existsSync(target)) return '';
  const content = fs.readFileSync(target, 'utf8');
  const arr = content.split('\n');
  return arr.slice(Math.max(0, arr.length - lines)).join('\n');
});

ipcMain.handle('logs:backend', async (_event, payload) => {
  const service = String(payload?.service || 'datafilter');
  const lines = Number(payload?.lines || 250);
  const started = Date.now();
  appendObserverLog('backend_logs:start', { service, lines });
  try {
    const out = await getBackendLogs(service, lines);
    appendObserverLog('backend_logs:done', {
      service,
      lines,
      latencyMs: Date.now() - started,
      bytes: String(out || '').length
    });
    return out;
  } catch (e) {
    const err = String(e.message || e);
    appendObserverLog('backend_logs:error', {
      service,
      lines,
      latencyMs: Date.now() - started,
      error: err
    });
    return `ERROR: ${err}`;
  }
});

ipcMain.on('diag:log', (_event, payload) => {
  appendObserverLog('diag:renderer', payload || {});
});

ipcMain.handle('env:get', () => runtimeEnvConfig);

ipcMain.handle('radio:db', async (_event, payload) => {
  const startIso = String(payload?.startIso || '');
  const endIso = String(payload?.endIso || '');
  const limit = Number(payload?.limit || 20000);
  const started = Date.now();
  appendObserverLog('radio_db:start', { startIso, endIso, limit });
  try {
    const rows = runtimeEnvConfig.useSyntheticDb
      ? syntheticDb.getRadioPoints(startIso, endIso, limit)
      : await getRadioPointsFromDb(startIso, endIso, limit);
    appendObserverLog('radio_db:done', {
      startIso, endIso, limit,
      latencyMs: Date.now() - started,
      rows: Array.isArray(rows) ? rows.length : 0
    });
    return rows;
  } catch (e) {
    const err = String(e.message || e);
    appendObserverLog('radio_db:error', { startIso, endIso, limit, latencyMs: Date.now() - started, error: err });
    return { error: err, rows: [] };
  }
});

ipcMain.handle('radio:meta', async () => {
  try {
    return runtimeEnvConfig.useSyntheticDb
      ? syntheticDb.getRadioMeta()
      : await getRadioMetaFromDb();
  } catch (e) {
    return { error: String(e.message || e), minIso: '', maxIso: '', count: 0 };
  }
});
