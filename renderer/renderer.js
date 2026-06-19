function arrMin(arr) { let m = Infinity;  for (let i = 0; i < arr.length; i++) { if (arr[i] < m) m = arr[i]; } return m; }
function arrMax(arr) { let m = -Infinity; for (let i = 0; i < arr.length; i++) { if (arr[i] > m) m = arr[i]; } return m; }

const ENV_DEFAULTS = {
  apiBase: 'http://127.0.0.1:13000/api',
  maxHandover: 1200,
  maxCollisions: 1200,
  maxBs: 600
};

let API_BASE = ENV_DEFAULTS.apiBase;
let MAX_HANDOVER = ENV_DEFAULTS.maxHandover;
let MAX_COLLISIONS = ENV_DEFAULTS.maxCollisions;
let MAX_BS = ENV_DEFAULTS.maxBs;
let DEFAULT_RANGE_START = '2025-06-14T08:00:00Z';
let DEFAULT_RANGE_END = '2025-06-14T10:09:07Z';

const state = {
  snapshot: null,
  map: null,
  tileLayer: null,
  tileWatchdog: null,
  tileEpoch: Date.now(),
  tileProvider: 'carto',
  tileStats: { started: 0, loaded: 0, errors: 0 },
  mapDataInfo: '',
  layers: {},
  lastMapData: null,
  pointRenderer: null,
  drawToken: 0,
  hasAutoFitted: false,
  worker: null,
  workerReqId: 1,
  workerPending: new Map(),
  lastNemo: null
};

const el = {
  tcpTable: document.getElementById('tcpTable'),
  metricsTable: document.getElementById('metricsTable'),
  lastUpdate: document.getElementById('lastUpdate'),

  pollInterval: document.getElementById('pollInterval'),
  timeoutMs: document.getElementById('timeoutMs'),
  applyConfig: document.getElementById('applyConfig'),
  envDump: document.getElementById('envDump'),
  tabs: document.getElementById('tabs'),

  mapStart: document.getElementById('mapStart'),
  mapEnd: document.getElementById('mapEnd'),
  mapOperator: document.getElementById('mapOperator'),
  mapRsrpMin: document.getElementById('mapRsrpMin'),
  mapRsrpMax: document.getElementById('mapRsrpMax'),
  mapRsrqMin: document.getElementById('mapRsrqMin'),
  mapRsrqMax: document.getElementById('mapRsrqMax'),
  mapLoad: document.getElementById('mapLoad'),
  mapRefreshTiles: document.getElementById('mapRefreshTiles'),
  mapInfo: document.getElementById('mapInfo'),
  showTrack: document.getElementById('showTrack'),
  showHeat: document.getElementById('showHeat'),
  showBadZones: document.getElementById('showBadZones'),
  showHandover: document.getElementById('showHandover'),
  showCollision3: document.getElementById('showCollision3'),
  showCollision6: document.getElementById('showCollision6'),
  showBaseStations: document.getElementById('showBaseStations'),

  plotStart: document.getElementById('plotStart'),
  plotEnd: document.getElementById('plotEnd'),
  plotMnc: document.getElementById('plotMnc'),
  plotCi: document.getElementById('plotCi'),
  plotBand: document.getElementById('plotBand'),
  plotMetric: document.getElementById('plotMetric'),
  plotLoad: document.getElementById('plotLoad'),
  plotInfo: document.getElementById('plotInfo'),
  plotKpi: document.getElementById('plotKpi'),

  dashboardRangeBadge: document.getElementById('dashboardRangeBadge'),
  dashKpis: document.getElementById('dashKpis'),
  dashTechDonut: document.getElementById('dashTechDonut'),
  dashTechLegend: document.getElementById('dashTechLegend'),
  dashOperatorDonut: document.getElementById('dashOperatorDonut'),
  dashOperatorLegend: document.getElementById('dashOperatorLegend'),
  dashQualityDonut: document.getElementById('dashQualityDonut'),
  dashQualityLegend: document.getElementById('dashQualityLegend'),
  dashTrendChart: document.getElementById('dashTrendChart'),
  dashTopCellsChart: document.getElementById('dashTopCellsChart'),

  logSource: document.getElementById('logSource'),
  backendService: document.getElementById('backendService'),
  refreshBackendLogs: document.getElementById('refreshBackendLogs'),
  backendLogsView: document.getElementById('backendLogsView'),
  logLines: document.getElementById('logLines'),
  autoLogs: document.getElementById('autoLogs'),

  tHost: document.getElementById('tHost'),
  tPort: document.getElementById('tPort'),
  tUser: document.getElementById('tUser'),
  tPassword: document.getElementById('tPassword'),
  saveTunnel: document.getElementById('saveTunnel'),
  startTunnel: document.getElementById('startTunnel'),
  stopTunnel: document.getElementById('stopTunnel'),
  reconnectTunnel: document.getElementById('reconnectTunnel'),
  tunnelStatus: document.getElementById('tunnelStatus'),
  fwTable: document.getElementById('fwTable')
};

// ── Session persistence (localStorage, cross-platform via Electron userData) ─
const SESSION_KEY = 'rbo_session_v2';
// Values to force-restore into selects whose options load asynchronously
let _sessionSelectRestore = {};

function saveSession() {
  try {
    const s = {
      mapStart:        el.mapStart.value,
      mapEnd:          el.mapEnd.value,
      plotStart:       el.plotStart.value,
      plotEnd:         el.plotEnd.value,
      mapOperator:     el.mapOperator.value,
      mapRsrpMin:      el.mapRsrpMin.value,
      mapRsrpMax:      el.mapRsrpMax.value,
      mapRsrqMin:      el.mapRsrqMin?.value,
      mapRsrqMax:      el.mapRsrqMax?.value,
      showTrack:       el.showTrack.checked,
      showHeat:        el.showHeat.checked,
      showBadZones:    el.showBadZones.checked,
      showHandover:    el.showHandover.checked,
      showCollision3:  el.showCollision3.checked,
      showCollision6:  el.showCollision6.checked,
      showBaseStations:el.showBaseStations.checked,
      plotMnc:         el.plotMnc.value,
      plotCi:          el.plotCi.value,
      plotMetric:      el.plotMetric.value,
      mapLat:          state.map?.getCenter()?.lat,
      mapLng:          state.map?.getCenter()?.lng,
      mapZoom:         state.map?.getZoom(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch (_) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function applySessionToInputs(s) {
  if (!s) return;
  if (s.mapStart)   el.mapStart.value   = s.mapStart;
  if (s.mapEnd)     el.mapEnd.value     = s.mapEnd;
  if (s.plotStart)  el.plotStart.value  = s.plotStart;
  if (s.plotEnd)    el.plotEnd.value    = s.plotEnd;
  if (s.mapRsrpMin != null) el.mapRsrpMin.value = s.mapRsrpMin;
  if (s.mapRsrpMax != null) el.mapRsrpMax.value = s.mapRsrpMax;
  if (s.mapRsrqMin != null && el.mapRsrqMin) el.mapRsrqMin.value = s.mapRsrqMin;
  if (s.mapRsrqMax != null && el.mapRsrqMax) el.mapRsrqMax.value = s.mapRsrqMax;
  el.showTrack.checked        = s.showTrack        ?? true;
  el.showHeat.checked         = s.showHeat         ?? true;
  el.showBadZones.checked     = s.showBadZones     ?? true;
  el.showHandover.checked     = s.showHandover     ?? true;
  el.showCollision3.checked   = s.showCollision3   ?? false;
  el.showCollision6.checked   = s.showCollision6   ?? false;
  el.showBaseStations.checked = s.showBaseStations ?? true;
  if (s.plotMetric) el.plotMetric.value = s.plotMetric;
  // Async selects: store desired values; replaceSelectOptions will apply them
  if (s.mapOperator) _sessionSelectRestore['mapOperator'] = s.mapOperator;
  if (s.plotMnc)     _sessionSelectRestore['plotMnc']     = s.plotMnc;
  if (s.plotCi)      _sessionSelectRestore['plotCi']      = s.plotCi;
}

function esc(v) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function logDiagnostic(payload) {
  try {
    window.observerApi.logDiagnostic(payload || {});
  } catch (_) {}
}

window.addEventListener('error', (e) => {
  logDiagnostic({
    event: 'renderer_error',
    message: String(e?.message || ''),
    source: String(e?.filename || ''),
    line: Number(e?.lineno || 0),
    column: Number(e?.colno || 0)
  });
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = e?.reason;
  logDiagnostic({
    event: 'renderer_unhandled_rejection',
    message: String(reason?.message || reason || 'unknown rejection'),
    stack: String(reason?.stack || '')
  });
});

async function fetchJsonWithDiag(url, label) {
  const started = performance.now();
  let status = 0;
  let payloadBytes = 0;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);

  try {
    const response = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    status = Number(response.status || 0);
    const txt = await response.text();
    payloadBytes = txt.length;

    if (!response.ok) {
      logDiagnostic({ event: 'api_http_error', label, endpoint: url, status, latencyMs: Math.round(performance.now() - started), payloadBytes });
      throw new Error(`${status} ${response.statusText}`);
    }

    try {
      const json = JSON.parse(txt);
      logDiagnostic({ event: 'api_ok', label, endpoint: url, status, latencyMs: Math.round(performance.now() - started), payloadBytes });
      return json;
    } catch (parseErr) {
      logDiagnostic({
        event: 'api_parse_error',
        label,
        endpoint: url,
        status,
        latencyMs: Math.round(performance.now() - started),
        payloadBytes,
        error: String(parseErr?.message || parseErr)
      });
      throw parseErr;
    }
  } catch (err) {
    logDiagnostic({
      event: 'api_request_error',
      label,
      endpoint: url,
      status,
      latencyMs: Math.round(performance.now() - started),
      payloadBytes,
      error: String(err?.message || err)
    });
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function initWorker() {
  state.worker = new Worker('./dataWorker.js');
  state.worker.onmessage = (event) => {
    const msg = event?.data || {};
    const slot = state.workerPending.get(msg.reqId);
    if (!slot) return;
    state.workerPending.delete(msg.reqId);
    if (msg.ok) slot.resolve(msg.data); else slot.reject(new Error(String(msg.error || 'Worker error')));
  };
}

function callWorker(type, payload) {
  return new Promise((resolve, reject) => {
    const reqId = state.workerReqId += 1;
    state.workerPending.set(reqId, { resolve, reject });
    state.worker.postMessage({ type, payload, reqId });
    setTimeout(() => {
      const slot = state.workerPending.get(reqId);
      if (!slot) return;
      state.workerPending.delete(reqId);
      reject(new Error(`worker timeout: ${type}`));
    }, 20000);
  });
}

async function applyEnvConfig() {
  try {
    const env = await window.observerApi.getEnvConfig();
    if (!env || typeof env !== 'object') return;
    API_BASE = String(env.apiBase || API_BASE);
    MAX_HANDOVER = Number(env.maxHandover) > 0 ? Number(env.maxHandover) : MAX_HANDOVER;
    MAX_COLLISIONS = Number(env.maxCollisions) > 0 ? Number(env.maxCollisions) : MAX_COLLISIONS;
    MAX_BS = Number(env.maxBs) > 0 ? Number(env.maxBs) : MAX_BS;
    DEFAULT_RANGE_START = String(env.defaultRangeStart || DEFAULT_RANGE_START);
    DEFAULT_RANGE_END = String(env.defaultRangeEnd || DEFAULT_RANGE_END);
    el.envDump.textContent = JSON.stringify(env, null, 2);
  } catch (_) {}
}

function setTab(tab) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  const mainEl = document.querySelector('main');
  mainEl.classList.toggle('map-active', tab === 'map');
  mainEl.classList.toggle('overview-active', tab === 'overview');
  if (tab === 'map' && state.map) setTimeout(() => state.map.invalidateSize(), 20);
}

// ── Chart utilities ──────────────────────────────────────────────────────────

function themeColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    bg:       dark ? '#0d1018' : '#f8f9fb',
    text:     dark ? '#c8d6e8' : '#334155',
    muted:    dark ? '#4a6080' : '#94a3b8',
    grid:     dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
    axis:     dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.14)',
    blue:     '#3b82f6',
    amber:    '#f59e0b',
    violet:   '#8b5cf6',
    handover: 'rgba(249,115,22,.55)',
  };
}

function rsrpZoneColor(v) {
  if (!Number.isFinite(v)) return '#94a3b8';
  if (v > -80)  return '#16a34a';
  if (v > -95)  return '#d97706';
  if (v > -110) return '#ea580c';
  return '#dc2626';
}

function metricZoneColor(field, v) {
  if (!Number.isFinite(v)) return '#94a3b8';
  if (field === 'rsrp') {
    if (v > -80)  return '#16a34a';
    if (v > -95)  return '#d97706';
    if (v > -110) return '#ea580c';
    return '#dc2626';
  }
  if (field === 'rsrq') {
    if (v > -9)  return '#16a34a';
    if (v > -14) return '#d97706';
    return '#dc2626';
  }
  if (field === 'sinr') {
    if (v > 20) return '#16a34a';
    if (v > 10) return '#3b82f6';
    if (v > 0)  return '#d97706';
    return '#dc2626';
  }
  return '#3b82f6';
}

function clearCanvas(canvas, msg) {
  const ctx = canvas.getContext('2d');
  const c = themeColors();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = c.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = c.muted;
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg || 'No data', canvas.width / 2, canvas.height / 2);
}

function fmtTime(ts) {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const yr  = String(d.getFullYear()).slice(2);
  const h   = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${mon}.${yr} ${h}:${min}`;
}

// Draw chart background, Y-grid, axes. Returns coordinate helpers + drawing context.
function chartBase(canvas, { yMin, yMax, nY = 5, yUnit = '' }) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const c = themeColors();
  ctx.clearRect(0, 0, W, H);

  const m = { top: 18, right: 20, bottom: 36, left: 62 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const range = yMax - yMin || 1;

  ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);

  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= nY; i++) {
    const v = yMin + range * i / nY;
    const y = m.top + plotH * (1 - i / nY);
    ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(m.left, y); ctx.lineTo(m.left + plotW, y); ctx.stroke();
    ctx.fillStyle = c.muted;
    ctx.fillText((Number.isInteger(v) ? Math.round(v) : v.toFixed(1)) + yUnit, m.left - 5, y);
  }

  ctx.strokeStyle = c.axis; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(m.left, m.top); ctx.lineTo(m.left, m.top + plotH); ctx.lineTo(m.left + plotW, m.top + plotH); ctx.stroke();

  const toX  = (i, n) => m.left + (i / Math.max(n - 1, 1)) * plotW;
  const toXv = (v, lo, hi) => m.left + ((v - lo) / ((hi - lo) || 1)) * plotW;
  const toY  = (v) => m.top + plotH - ((v - yMin) / range) * plotH;
  const cy   = (v) => Math.max(m.top - 2, Math.min(m.top + plotH + 2, toY(v)));

  return { ctx, c, m, W, H, plotW, plotH, toX, toXv, toY, cy };
}

function drawTimeAxis(ctx, c, m, plotW, plotH, times) {
  const n = times.length;
  if (!n) return;
  const labelW = 100;
  const step = Math.max(1, Math.floor(n / Math.floor(plotW / labelW)));
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = c.muted;
  for (let i = 0; i < n; i += step) ctx.fillText(fmtTime(times[i]), m.left + (i / (n - 1)) * plotW, m.top + plotH + 4);
  if ((n - 1) % step !== 0) ctx.fillText(fmtTime(times[n - 1]), m.left + plotW, m.top + plotH + 4);
}

function drawRefLine(ctx, m, plotW, y, label, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(m.left, y); ctx.lineTo(m.left + plotW, y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color; ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(label, m.left + 3, y - 1);
  ctx.restore();
}

// ── Chart registry: zoom/pan/fullscreen ──────────────────────────────────────
const chartRegistry = new Map();
const modalState = { zoom: { x0: 0, x1: 1 }, drawFn: null, args: [], isDragging: false };

function renderChart(canvas, drawFn, ...args) {
  let entry = chartRegistry.get(canvas);
  if (!entry) {
    entry = { zoom: { x0: 0, x1: 1 }, isDragging: false };
    chartRegistry.set(canvas, entry);
    attachZoomPan(canvas, entry);
    injectChartToolbar(canvas, entry);
  }
  entry.drawFn = drawFn;
  entry.args = args;
  drawFn(canvas, ...args, entry.zoom);
}

window.resetMapTileLayer = function () {
  if (typeof resetTileLayer === 'function') resetTileLayer();
};

window.reRenderAllCharts = function () {
  for (const [cv, en] of chartRegistry) {
    if (en.drawFn) en.drawFn(cv, ...en.args, en.zoom);
  }
  const modal = document.getElementById('chartModal');
  if (modal && modal.style.display !== 'none') {
    const mc = document.getElementById('chartModalCanvas');
    if (modalState.drawFn) modalState.drawFn(mc, ...modalState.args, modalState.zoom);
  }
};

function attachZoomPan(canvas, entry) {
  canvas.style.cursor = 'crosshair';

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const range = entry.zoom.x1 - entry.zoom.x0;
    const factor = e.deltaY > 0 ? 1.2 : 0.833;
    const newRange = Math.max(0.02, Math.min(1, range * factor));
    const center = entry.zoom.x0 + xFrac * range;
    entry.zoom.x0 = Math.max(0, Math.min(1 - newRange, center - xFrac * newRange));
    entry.zoom.x1 = entry.zoom.x0 + newRange;
    if (entry.drawFn) entry.drawFn(canvas, ...entry.args, entry.zoom);
  }, { passive: false });

  let dragStartX = 0, dragStartZoom = null;
  canvas.addEventListener('mousedown', (e) => {
    entry.isDragging = true;
    dragStartX = e.clientX;
    dragStartZoom = { ...entry.zoom };
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!entry.isDragging) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - dragStartX) / rect.width;
    const range = dragStartZoom.x1 - dragStartZoom.x0;
    const x0 = Math.max(0, Math.min(1 - range, dragStartZoom.x0 - dx));
    entry.zoom.x0 = x0;
    entry.zoom.x1 = x0 + range;
    if (entry.drawFn) entry.drawFn(canvas, ...entry.args, entry.zoom);
  });
  window.addEventListener('mouseup', () => {
    if (!entry.isDragging) return;
    entry.isDragging = false;
    canvas.style.cursor = 'crosshair';
  });
  canvas.addEventListener('dblclick', () => {
    entry.zoom = { x0: 0, x1: 1 };
    if (entry.drawFn) entry.drawFn(canvas, ...entry.args, entry.zoom);
  });
}

function injectChartToolbar(canvas, entry) {
  const panel = canvas.closest('.panel');
  if (!panel) return;
  const h2 = panel.querySelector('h2');
  if (!h2 || h2.parentElement.classList.contains('chart-header')) return;

  const header = document.createElement('div');
  header.className = 'chart-header';
  h2.parentNode.insertBefore(header, h2);
  header.appendChild(h2);

  const mkBtn = (title, svgBody) => {
    const b = document.createElement('button');
    b.className = 'chart-btn';
    b.title = title;
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" width="13" height="13">${svgBody}</svg>`;
    return b;
  };

  const resetBtn = mkBtn('Сбросить зум (dblclick)',
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>');
  resetBtn.addEventListener('click', () => {
    entry.zoom = { x0: 0, x1: 1 };
    if (entry.drawFn) entry.drawFn(canvas, ...entry.args, entry.zoom);
  });

  const expandBtn = mkBtn('На весь экран',
    '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>' +
    '<line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>');
  expandBtn.addEventListener('click', () => openChartFullscreen(canvas, h2.textContent.trim()));

  header.appendChild(resetBtn);
  header.appendChild(expandBtn);

  const hint = document.createElement('div');
  hint.className = 'chart-hint';
  hint.textContent = 'scroll — zoom · drag — pan · dblclick — reset';
  canvas.after(hint);
}

function openChartFullscreen(sourceCanvas, title) {
  const entry = chartRegistry.get(sourceCanvas);
  if (!entry || !entry.drawFn) return;

  const modal = document.getElementById('chartModal');
  const modalCanvas = document.getElementById('chartModalCanvas');
  document.getElementById('chartModalTitle').textContent = title;

  modalState.drawFn = entry.drawFn;
  modalState.args = entry.args;
  modalState.zoom = { ...entry.zoom };

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    const wrap = document.getElementById('chartModalWrap');
    const w = wrap.clientWidth - 32;
    const h = Math.max(420, Math.round(w * 0.44));
    modalCanvas.width = w;
    modalCanvas.height = h;
    modalState.drawFn(modalCanvas, ...modalState.args, modalState.zoom);
  });
}

function initChartModal() {
  const modalCanvas = document.getElementById('chartModalCanvas');
  attachZoomPan(modalCanvas, modalState);

  const closeModal = () => {
    document.getElementById('chartModal').style.display = 'none';
    document.body.style.overflow = '';
  };

  document.getElementById('chartModalClose').addEventListener('click', closeModal);
  document.getElementById('chartModalReset').addEventListener('click', () => {
    modalState.zoom = { x0: 0, x1: 1 };
    if (modalState.drawFn) {
      modalState.drawFn(modalCanvas, ...modalState.args, modalState.zoom);
    }
  });
  document.getElementById('chartModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('chartModal')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('chartModal').style.display !== 'none') closeModal();
  });
  window.addEventListener('resize', () => {
    const modal = document.getElementById('chartModal');
    if (modal.style.display === 'none') return;
    const wrap = document.getElementById('chartModalWrap');
    const w = wrap.clientWidth - 32;
    const h = Math.max(420, Math.round(w * 0.44));
    modalCanvas.width = w;
    modalCanvas.height = h;
    if (modalState.drawFn) modalState.drawFn(modalCanvas, ...modalState.args, modalState.zoom);
  });
}

function rsrpColor(v) {
  if (!Number.isFinite(v)) return '#94a3b8';
  if (v > -80)  return '#16a34a';
  if (v > -95)  return '#d97706';
  if (v > -110) return '#ea580c';
  return '#dc2626';
}


function renderTables(snapshot) {
  el.tcpTable.innerHTML = (snapshot?.tcpResults || []).map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.host)}:${esc(r.port)}</td><td class="${r.open ? 'ok' : 'warn'}">${r.open ? 'OPEN' : 'Подключение...'}</td><td>${esc(r.latencyMs)} ms</td><td class="muted">${esc(r.error || '')}</td></tr>`).join('');
  el.metricsTable.innerHTML = (snapshot?.metrics || []).map((m) => `<tr><td>${esc(m.source)}</td><td>${esc(m.metric)}</td><td>${esc(m.value)}</td></tr>`).join('');
}

function initMap() {
  state.map = L.map('mapView', { preferCanvas: false, attributionControl: false }).setView([55.0152, 82.9296], 12);
  state.pointRenderer = null;
  resetTileLayer();

  state.layers.track = L.polyline([], { color: '#4ea5ff', weight: 2.5 });
  state.layers.heat = L.layerGroup();
  state.layers.badZones = L.layerGroup();
  state.layers.handover = L.layerGroup();
  state.layers.collision3 = L.layerGroup();
  state.layers.collision6 = L.layerGroup();
  state.layers.bs = L.layerGroup();

  state.map.on('moveend zoomend', () => {
    if (state.lastMapData) redrawMap(state.lastMapData);
  });
}

function updateTileInfo(extra = '') {
  const s = state.tileStats;
  const base = `tiles(${state.tileProvider}): start=${s.started} ok=${s.loaded} err=${s.errors}`;
  const parts = [base];
  if (state.mapDataInfo) parts.push(state.mapDataInfo);
  if (extra) parts.push(extra);
  el.mapInfo.textContent = parts.join(' | ');
}

function setMapDataInfo(text) {
  state.mapDataInfo = String(text || '').trim();
  updateTileInfo();
}

function tileSource(provider, epoch) {
  if (provider === 'carto') {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const style = isDark ? 'dark_all' : 'light_all';
    return `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png?v=${epoch}`;
  }
  return `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png?v=${epoch}`;
}

function resetTileLayer(provider = state.tileProvider) {
  if (!state.map) return;
  if (state.tileLayer) {
    state.map.removeLayer(state.tileLayer);
    state.tileLayer.off();
  }
  if (state.tileWatchdog) {
    clearTimeout(state.tileWatchdog);
    state.tileWatchdog = null;
  }

  state.tileProvider = provider;
  state.tileStats = { started: 0, loaded: 0, errors: 0 };
  state.tileEpoch = Date.now();
  const tileUrl = tileSource(state.tileProvider, state.tileEpoch);

  const tileOpts = {
    maxZoom: state.tileProvider === 'carto' ? 20 : 19,
    maxNativeZoom: state.tileProvider === 'carto' ? 20 : 19,
    attribution: state.tileProvider === 'carto'
      ? '&copy; OpenStreetMap contributors &copy; CARTO'
      : '&copy; OpenStreetMap contributors',
    updateWhenZooming: true,
    updateWhenIdle: false,
    updateInterval: 150,
    keepBuffer: 4,
    detectRetina: true
  };
  tileOpts.subdomains = state.tileProvider === 'carto' ? 'abcd' : 'abc';
  state.tileLayer = L.tileLayer(tileUrl, tileOpts);

  state.tileLayer.on('tileloadstart', (evt) => {
    state.tileStats.started += 1;
    const c = evt?.coords || {};
    logDiagnostic({ event: 'tile_load_start', z: c.z, x: c.x, y: c.y, src: evt?.tile?.src || '' });
    updateTileInfo();
  });

  state.tileLayer.on('tileload', (evt) => {
    state.tileStats.loaded += 1;
    const c = evt?.coords || {};
    logDiagnostic({ event: 'tile_load_ok', z: c.z, x: c.x, y: c.y, src: evt?.tile?.src || '' });
    updateTileInfo();
  });

  state.tileLayer.on('tileerror', (evt) => {
    state.tileStats.errors += 1;
    const c = evt?.coords || {};
    logDiagnostic({
      event: 'tile_load_error',
      z: c.z,
      x: c.x,
      y: c.y,
      src: evt?.tile?.src || '',
      error: String(evt?.error?.message || evt?.error || 'tile error')
    });
    if (state.tileStats.loaded === 0 && state.tileStats.errors >= 6) {
      logDiagnostic({ event: 'tile_provider_retry', provider: state.tileProvider, reason: 'continuous tile errors' });
      resetTileLayer(state.tileProvider);
      updateTileInfo('tile error, retrying...');
      return;
    }
    updateTileInfo('tile error');
  });

  state.tileLayer.addTo(state.map);

  // If requests start but never resolve (neither load nor error), force provider fallback.
  state.tileWatchdog = setTimeout(() => {
    const s = state.tileStats;
    if (s.started > 0 && s.loaded === 0 && s.errors === 0) {
      logDiagnostic({ event: 'tile_watchdog_retry', provider: state.tileProvider, started: s.started });
      resetTileLayer(state.tileProvider);
      updateTileInfo('tile watchdog: retrying...');
    }
  }, 9000);
}

function mapBounds() {
  const b = state.map.getBounds();
  return { x1: b.getWest(), y1: b.getSouth(), x2: b.getEast(), y2: b.getNorth() };
}

function setLayerVisible(layerName, visible) {
  const layer = state.layers[layerName];
  if (!layer) return;
  if (visible) layer.addTo(state.map); else state.map.removeLayer(layer);
}

function applyLayerToggles() {
  setLayerVisible('track', el.showTrack.checked);
  setLayerVisible('heat', el.showHeat.checked);
  setLayerVisible('badZones', el.showBadZones.checked);
  setLayerVisible('handover', el.showHandover.checked);
  setLayerVisible('collision3', el.showCollision3.checked);
  setLayerVisible('collision6', el.showCollision6.checked);
  setLayerVisible('bs', el.showBaseStations.checked);
}

// MCC 250 (Russia) operator names
const MNC_NAMES = {
  '1': 'МТС',
  '2': 'МегаФон',
  '3': 'Ростелеком',
  '4': 'Сибирьтелеком',
  '10': 'DTC',
  '20': 'Tele2',
  '39': 'Ростелеком',
  '50': 'Ростелеком',
  '92': 'Пр-Телеком',
  '99': 'Билайн',
};
function mncLabel(mnc) {
  const s = String(mnc);
  return MNC_NAMES[s] ? `${MNC_NAMES[s]} (${s})` : s;
}

function replaceSelectOptions(selectEl, values, includeAll) {
  const restoreKey = Object.keys(_sessionSelectRestore).find((k) => selectEl.id === k || selectEl === el[k]);
  const prev = (restoreKey && _sessionSelectRestore[restoreKey]) || selectEl.value;
  if (restoreKey) delete _sessionSelectRestore[restoreKey];
  const arr = Array.isArray(values) ? values : [];
  const opts = includeAll ? ['all', ...arr] : arr;
  const isMnc = selectEl === el.mapOperator || selectEl === el.plotMnc;
  selectEl.innerHTML = opts.map((v) => {
    const label = (isMnc && v !== 'all') ? mncLabel(v) : esc(String(v));
    return `<option value="${esc(String(v))}">${label}</option>`;
  }).join('');
  if (prev && opts.map(String).includes(String(prev))) selectEl.value = prev;
}

function addLayerItemsChunked(items, batchSize, fn, token) {
  let i = 0;
  function step() {
    if (token !== state.drawToken) return;
    const end = Math.min(i + batchSize, items.length);
    for (; i < end; i += 1) fn(items[i]);
    if (i < items.length) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function splitTrackByGap(points, maxKm) {
  const segments = [];
  let seg = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0 && seg.length > 0) {
      const prev = seg[seg.length - 1];
      if (distKm(prev[0], prev[1], p.lat, p.lon) > maxKm) {
        if (seg.length > 1) segments.push(seg);
        seg = [];
      }
    }
    seg.push([p.lat, p.lon]);
  }
  if (seg.length > 1) segments.push(seg);
  return segments;
}

function redrawMap(data) {
  state.drawToken += 1;
  const token = state.drawToken;
  state.layers.heat.clearLayers();
  state.layers.badZones.clearLayers();
  state.layers.handover.clearLayers();
  state.layers.collision3.clearLayers();
  state.layers.collision6.clearLayers();
  state.layers.bs.clearLayers();

  const allPoints = data.points || [];
  const bounds = state.map.getBounds();
  const points = allPoints.filter((p) => bounds.contains([p.lat, p.lon]));
  state.layers.track.setLatLngs(splitTrackByGap(allPoints, 1.0));

  addLayerItemsChunked(points, 500, (p) => {
    L.circleMarker([p.lat, p.lon], { radius: 4, color: rsrpColor(p.rsrp), weight: 1, fillOpacity: 0.85 })
      .bindTooltip(`RSRP: ${p.rsrp} dBm<br/>RSRQ: ${p.rsrq}<br/>SINR: ${p.sinr}`)
      .addTo(state.layers.heat);
  }, token);

  const badZones = (data.badZones || []).filter((p) => bounds.contains([p.lat, p.lon]));
  addLayerItemsChunked(badZones, 300, (p) => {
    L.circleMarker([p.lat, p.lon], { radius: 6, color: '#ff2d55', weight: 1, fillOpacity: 0.3 }).addTo(state.layers.badZones);
  }, token);

  (data.handover || []).forEach((pair) => {
    const from = Array.isArray(pair) ? pair[0] : pair?.from;
    const to = Array.isArray(pair) ? pair[1] : pair?.to;
    if (!from || !to) return;
    const a = [Number(from.latitude), Number(from.longitude)];
    const b = [Number(to.latitude), Number(to.longitude)];
    if (a.every(Number.isFinite) && b.every(Number.isFinite) && distKm(a[0], a[1], b[0], b[1]) <= 3.0) L.polyline([a, b], { color: '#ff7f50', weight: 2, opacity: 0.8 }).addTo(state.layers.handover);
  });

  addLayerItemsChunked((data.coll3 || []), 400, (p) => {
    const lat = Number(p.latitude || p.lat);
    const lon = Number(p.longitude || p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!bounds.contains([lat, lon])) return;
    L.circleMarker([lat, lon], { radius: 5, color: '#f94144', fillOpacity: 0.4 }).addTo(state.layers.collision3);
  }, token);

  addLayerItemsChunked((data.coll6 || []), 400, (p) => {
    const lat = Number(p.latitude || p.lat);
    const lon = Number(p.longitude || p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!bounds.contains([lat, lon])) return;
    L.circleMarker([lat, lon], { radius: 5, color: '#9b5de5', fillOpacity: 0.4 }).addTo(state.layers.collision6);
  }, token);

  (data.bs || []).forEach((bs) => {
    const lat = Number(bs.lat);
    const lon = Number(bs.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      L.circleMarker([lat, lon], { radius: 6, color: '#00d4ff', fillOpacity: 0.8 }).bindTooltip(`MNC:${bs.mnc} CI:${bs.ci}`).addTo(state.layers.bs);
    }
    (Array.isArray(bs.polygons) ? bs.polygons : []).forEach((poly) => {
      const coords = (poly.vertices || []).map((v) => [Number(v[0]), Number(v[1])]).filter((v) => Number.isFinite(v[0]) && Number.isFinite(v[1]));
      if (coords.length > 2) L.polygon(coords, { color: '#00d4ff', fillOpacity: 0.08, weight: 1 }).addTo(state.layers.bs);
    });
  });

  applyLayerToggles();

  if (allPoints.length && !state.hasAutoFitted) {
    const fitBounds = L.latLngBounds(allPoints.map((p) => [p.lat, p.lon]));
    state.map.fitBounds(fitBounds.pad(0.1));
    state.hasAutoFitted = true;
  }
  state.map.invalidateSize(false);
}

async function resolveFallbackRangeIso() {
  try {
    const meta = await window.observerApi.getRadioMeta();
    const maxIso = String(meta?.maxIso || '').trim();
    const maxTs = Date.parse(maxIso);
    if (!Number.isFinite(maxTs)) return null;
    return {
      start: new Date(maxTs - 2 * 60 * 60 * 1000).toISOString(),
      end: new Date(maxTs).toISOString()
    };
  } catch (_) {
    return null;
  }
}

async function loadMapData(opts = {}) {
  const triedFallback = Boolean(opts.triedFallback);
  const start = el.mapStart.value.trim();
  const end = el.mapEnd.value.trim();
  if (!start || !end) {
    updateTileInfo('Укажи Start/End ISO');
    return;
  }

  const { x1, y1, x2, y2 } = mapBounds();

  let list = [];
  try {
    const rows = await window.observerApi.getRadioPoints(start, end, 80000);
    if (rows && !Array.isArray(rows) && rows.error) {
      updateTileInfo(`DB fallback error: ${rows.error}`);
      return;
    }
    list = Array.isArray(rows) ? rows : (rows?.rows || []);
  } catch (e) {
    updateTileInfo(`DB fallback error: ${String(e.message || e)}`);
    return;
  }

  // Fetch API overlays in parallel with (or right after) DB data
  const [handover, coll3, coll6, bs] = await Promise.all([
    fetchJsonWithDiag(`${API_BASE}/v1/filter/handover/${y1}/${x1}/${y2}/${x2}`, 'map:handover').catch(() => []),
    fetchJsonWithDiag(`${API_BASE}/v1/filter/collision/3/${y1}/${x1}/${y2}/${x2}`, 'map:collision3').catch(() => []),
    fetchJsonWithDiag(`${API_BASE}/v1/filter/collision/6/${y1}/${x1}/${y2}/${x2}`, 'map:collision6').catch(() => []),
    fetchJsonWithDiag(`${API_BASE}/v1/filter/basestations/${y1}/${x1}/${y2}/${x2}`, 'map:basestations').catch(() => [])
  ]);

  const prepared = await callWorker('prepareMap', {
    dbRows: list,
    handover: Array.isArray(handover) ? handover : [],
    coll3: Array.isArray(coll3) ? coll3 : [],
    coll6: Array.isArray(coll6) ? coll6 : [],
    bs: Array.isArray(bs) ? bs : [],
    filters: {
      operator: el.mapOperator.value,
      rsrpMin: Number(el.mapRsrpMin.value),
      rsrpMax: Number(el.mapRsrpMax.value),
      rsrqMin: Number(el.mapRsrqMin.value),
      rsrqMax: Number(el.mapRsrqMax.value)
    },
    maxHandover: MAX_HANDOVER,
    maxCollisions: MAX_COLLISIONS,
    maxBs: MAX_BS
  });
  state.lastMapData = prepared;
  redrawMap(prepared);
  if (prepared.operators.length) replaceSelectOptions(el.mapOperator, prepared.operators, true);
  setMapDataInfo(`db+api: points=${prepared.stats.renderPoints} handover=${prepared.stats.handover} coll3=${prepared.stats.coll3} coll6=${prepared.stats.coll6} bs=${prepared.stats.bs}`);

  if (prepared.stats.renderPoints === 0 && !triedFallback) {
    const fallback = await resolveFallbackRangeIso();
    if (fallback) {
      if (window.setMapTimeRange) window.setMapTimeRange(fallback.start, fallback.end);
      else { el.mapStart.value = fallback.start; el.mapEnd.value = fallback.end; }
      setMapDataInfo(`fallback(db): auto-range ${fallback.start} .. ${fallback.end}`);
      await loadMapData({ triedFallback: true });
    }
  }
}

// ── Chart: multi-series time (RSRP + RSRQ + SINR) ────────────────────────────
function drawMultiSeriesWithHandovers(canvas, points, handovers, zoom) {
  if (!points.length) { clearCanvas(canvas, 'Нет данных'); return; }
  const z = zoom || { x0: 0, x1: 1 };
  const _n = points.length;
  const _i0 = Math.floor(z.x0 * _n), _i1 = Math.max(_i0 + 2, Math.ceil(z.x1 * _n));
  points = points.slice(_i0, _i1);
  handovers = (handovers || []).filter(h => (h.i || 0) >= _i0 && (h.i || 0) < _i1)
    .map(h => ({ ...h, i: (h.i || 0) - _i0 }));

  const rsrp = points.map((p) => p.rsrp);
  const rsrq = points.map((p) => p.rsrq);
  const sinr = points.map((p) => p.sinr);
  const times = points.map((p) => p.t);

  const allVals = [...rsrp, ...rsrq, ...sinr].filter(Number.isFinite);
  if (!allVals.length) { clearCanvas(canvas, 'Нет числовых значений'); return; }

  const yMin = Math.floor(arrMin(allVals) / 5) * 5 - 5;
  const yMax = Math.ceil(arrMax(allVals)  / 5) * 5 + 5;

  const { ctx, c, m, plotW, plotH, toX, cy } = chartBase(canvas, { yMin, yMax, nY: 6, yUnit: ' dB' });
  const N = points.length;

  // handover verticals
  for (const h of handovers || []) {
    const x = toX(h.i || 0, N);
    ctx.strokeStyle = c.handover; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, m.top); ctx.lineTo(x, m.top + plotH); ctx.stroke();
    ctx.setLineDash([]);
  }

  // RSRP — colored by quality zones
  for (let i = 1; i < N; i++) {
    if (!Number.isFinite(rsrp[i]) || !Number.isFinite(rsrp[i-1])) continue;
    ctx.strokeStyle = rsrpZoneColor(rsrp[i]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(toX(i-1, N), cy(rsrp[i-1]));
    ctx.lineTo(toX(i,   N), cy(rsrp[i]));
    ctx.stroke();
  }

  // RSRQ — amber dashed
  ctx.strokeStyle = c.amber; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(rsrq[i])) { first = true; continue; }
    const x = toX(i, N), y = cy(rsrq[i]);
    first ? ctx.moveTo(x, y) : ctx.lineTo(x, y); first = false;
  }
  ctx.stroke(); ctx.setLineDash([]);

  // SINR — violet dashed
  ctx.strokeStyle = c.violet; ctx.lineWidth = 1.2; ctx.setLineDash([2, 4]);
  ctx.beginPath(); first = true;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(sinr[i])) { first = true; continue; }
    const x = toX(i, N), y = cy(sinr[i]);
    first ? ctx.moveTo(x, y) : ctx.lineTo(x, y); first = false;
  }
  ctx.stroke(); ctx.setLineDash([]);

  // ref lines
  const refY_95  = m.top + plotH - ((-95  - yMin) / (yMax - yMin)) * plotH;
  const refY_110 = m.top + plotH - ((-110 - yMin) / (yMax - yMin)) * plotH;
  if (refY_95  >= m.top && refY_95  <= m.top + plotH) drawRefLine(ctx, m, plotW, refY_95,  '-95 dBm', '#d97706');
  if (refY_110 >= m.top && refY_110 <= m.top + plotH) drawRefLine(ctx, m, plotW, refY_110, '-110 dBm', '#dc2626');

  // time axis
  drawTimeAxis(ctx, c, m, plotW, plotH, times);

  // legend
  const leg = [
    { color: '#16a34a', dash: [],   label: 'RSRP' },
    { color: c.amber,   dash: [4,3], label: 'RSRQ' },
    { color: c.violet,  dash: [2,4], label: 'SINR' },
  ];
  let lx = m.left + 6;
  ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const { color, dash, label } of leg) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(lx, m.top - 8); ctx.lineTo(lx + 18, m.top - 8); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = c.text; ctx.textAlign = 'left';
    ctx.fillText(label, lx + 22, m.top - 8);
    lx += 60;
  }
}

// ── Chart: histogram with quality zones ──────────────────────────────────────
function drawHistogram(canvas, values, unit, field, zoom) {
  if (!values || !values.length) { clearCanvas(canvas, 'Нет данных'); return; }
  const z = zoom || { x0: 0, x1: 1 };
  const _sv = [...values].sort((a, b) => a - b);
  const _i0 = Math.floor(z.x0 * _sv.length), _i1 = Math.max(_i0 + 1, Math.ceil(z.x1 * _sv.length));
  values = _sv.slice(_i0, _i1);

  const bins = 24;
  const vMin = arrMin(values), vMax = arrMax(values);
  const bw = (vMax - vMin) / bins || 1;
  const counts = Array(bins).fill(0);
  values.forEach((v) => {
    const idx = Math.min(bins - 1, Math.floor((v - vMin) / bw));
    counts[idx]++;
  });
  const maxCount = arrMax(counts) || 1;

  const { ctx, c, m, plotW, plotH } = chartBase(canvas, { yMin: 0, yMax: maxCount, nY: 4, yUnit: '' });

  const barW = plotW / bins;
  counts.forEach((cnt, i) => {
    const bv = vMin + i * bw + bw / 2;
    const bh = (cnt / maxCount) * plotH;
    const bx = m.left + i * barW;
    const by = m.top + plotH - bh;
    ctx.fillStyle = field ? metricZoneColor(field, bv) : '#3b82f6';
    ctx.globalAlpha = 0.75;
    ctx.fillRect(bx + 1, by, barW - 2, bh);
    ctx.globalAlpha = 1;
  });

  ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.textBaseline = 'top'; ctx.fillStyle = c.muted;
  const step = Math.max(1, Math.floor(bins / 6));
  for (let i = 0; i <= bins; i += step) {
    const v = vMin + i * bw;
    ctx.fillText(v.toFixed(0) + (unit || ''), m.left + i * barW, m.top + plotH + 4);
  }
}

// ── Chart: CDF with P50/P90/P10 markers ──────────────────────────────────────
function drawCDF(canvas, values, zoom) {
  if (!values.length) { clearCanvas(canvas, 'Нет данных'); return; }
  const z = zoom || { x0: 0, x1: 1 };
  const _sv = [...values].sort((a, b) => a - b);
  const _i0 = Math.floor(z.x0 * _sv.length), _i1 = Math.max(_i0 + 1, Math.ceil(z.x1 * _sv.length));
  values = _sv.slice(_i0, _i1);

  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0], hi = sorted[sorted.length - 1];

  const { ctx, c, m, plotW, plotH, toXv, toY } = chartBase(canvas, { yMin: 0, yMax: 1, nY: 5, yUnit: '' });

  // shaded area under curve
  ctx.beginPath();
  sorted.forEach((v, i) => {
    const x = toXv(v, lo, hi), y = toY((i + 1) / sorted.length);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(toXv(hi, lo, hi), toY(0));
  ctx.lineTo(toXv(lo, lo, hi), toY(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(59,130,246,.12)'; ctx.fill();

  // CDF line
  ctx.strokeStyle = c.blue; ctx.lineWidth = 2;
  ctx.beginPath();
  sorted.forEach((v, i) => {
    const x = toXv(v, lo, hi), y = toY((i + 1) / sorted.length);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // P10 / P50 / P90 markers
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const markers = [
    { p: 0.10, label: 'P10', color: '#dc2626' },
    { p: 0.50, label: 'P50', color: '#d97706' },
    { p: 0.90, label: 'P90', color: '#16a34a' },
  ];
  for (const mk of markers) {
    const v = pct(mk.p);
    const x = toXv(v, lo, hi);
    const y = toY(mk.p);
    ctx.strokeStyle = mk.color; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, m.top); ctx.lineTo(x, m.top + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = mk.color; ctx.font = '9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${mk.label}=${v.toFixed(1)}`, x, m.top + plotH - 2 + (mk.p > 0.5 ? -14 : 0));
    // dot
    ctx.fillStyle = mk.color;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }

  // X axis labels
  ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.textBaseline = 'top'; ctx.fillStyle = c.muted;
  const nLabels = 6;
  for (let i = 0; i <= nLabels; i++) {
    const v = lo + (hi - lo) * i / nLabels;
    ctx.fillText(v.toFixed(0), toXv(v, lo, hi), m.top + plotH + 4);
  }
}

// ── Chart: RSRP vs SINR scatter ───────────────────────────────────────────────
function drawScatter(canvas, points, xlabel, ylabel, zoom) {
  if (!points.length) { clearCanvas(canvas, 'Нет данных'); return; }
  const z = zoom || { x0: 0, x1: 1 };
  const _sp = [...points].sort((a, b) => a.x - b.x);
  const _i0 = Math.floor(z.x0 * _sp.length), _i1 = Math.max(_i0 + 1, Math.ceil(z.x1 * _sp.length));
  points = _sp.slice(_i0, _i1);

  if (!xlabel) xlabel = 'X'; if (!ylabel) ylabel = 'Y';
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xLo = arrMin(xs), xHi = arrMax(xs);
  const yLo = arrMin(ys), yHi = arrMax(ys);

  const { ctx, c, m, plotW, plotH, toXv } = chartBase(canvas, {
    yMin: Math.floor(yLo / 5) * 5 - 5,
    yMax: Math.ceil(yHi  / 5) * 5 + 5,
    nY: 5, yUnit: ' dB'
  });

  // regression line
  if (points.length > 2) {
    const n = points.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);
    const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
    if (den) {
      const slope = num / den;
      const intercept = meanY - slope * meanX;
      const toY2 = (v) => {
        const yMin2 = Math.floor(yLo / 5) * 5 - 5, yMax2 = Math.ceil(yHi / 5) * 5 + 5;
        return m.top + plotH - ((v - yMin2) / (yMax2 - yMin2)) * plotH;
      };
      ctx.strokeStyle = 'rgba(239,68,68,.45)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(toXv(xLo, xLo, xHi), toY2(slope * xLo + intercept));
      ctx.lineTo(toXv(xHi, xLo, xHi), toY2(slope * xHi + intercept));
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // points
  const toY2 = (v) => {
    const yMin2 = Math.floor(yLo / 5) * 5 - 5, yMax2 = Math.ceil(yHi / 5) * 5 + 5;
    return m.top + plotH - ((v - yMin2) / (yMax2 - yMin2)) * plotH;
  };
  for (const p of points) {
    const x = toXv(p.x, xLo, xHi), y = toY2(p.y);
    ctx.fillStyle = rsrpZoneColor(p.x);
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // X axis labels
  ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.textBaseline = 'top'; ctx.fillStyle = c.muted;
  for (let i = 0; i <= 6; i++) {
    const v = xLo + (xHi - xLo) * i / 6;
    ctx.fillText(v.toFixed(0), toXv(v, xLo, xHi), m.top + plotH + 4);
  }

  // axis labels
  ctx.textAlign = 'center'; ctx.fillStyle = c.muted; ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.fillText('RSRP (dBm) →', m.left + plotW / 2, m.top + plotH + 20);
  ctx.save(); ctx.translate(12, m.top + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('SINR (dB)', 0, 0); ctx.restore();
}

// ── Chart: serving cell (CI) timeline as color-band ───────────────────────────
function drawPciTimeline(canvas, points, zoom) {
  if (!points.length) { clearCanvas(canvas, 'Нет данных'); return; }
  const z = zoom || { x0: 0, x1: 1 };
  const _n = points.length;
  const _i0 = Math.floor(z.x0 * _n), _i1 = Math.max(_i0 + 2, Math.ceil(z.x1 * _n));
  points = points.slice(_i0, _i1);

  const ctx = canvas.getContext('2d');
  const c = themeColors();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);

  const times = points.map((p) => p.t);
  const uniqCI = [...new Set(points.map((p) => p.ci).filter(Boolean))];
  const palette = ['#3b82f6','#f59e0b','#10b981','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899'];
  const ciColor = (ci) => palette[uniqCI.indexOf(ci) % palette.length] || c.muted;

  const m = { top: 20, right: 20, bottom: 36, left: 62 };
  const plotW = W - m.left - m.right;
  const rowH = H - m.top - m.bottom;
  const N = points.length;

  // draw segments
  for (let i = 0; i < N; i++) {
    const x0 = m.left + (i / N) * plotW;
    const x1 = m.left + ((i + 1) / N) * plotW;
    ctx.fillStyle = ciColor(points[i].ci);
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x0, m.top, x1 - x0 + 0.5, rowH);
  }
  ctx.globalAlpha = 1;

  // handover markers (CI changes)
  for (let i = 1; i < N; i++) {
    if (points[i].ci !== points[i - 1].ci && points[i].ci) {
      const x = m.left + (i / N) * plotW;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, m.top); ctx.lineTo(x, m.top + rowH); ctx.stroke();
    }
  }

  // legend (up to 6 cells)
  let lx = m.left;
  ctx.font = '9px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (const ci of uniqCI.slice(0, 6)) {
    ctx.fillStyle = ciColor(ci); ctx.fillRect(lx, 4, 10, 10);
    ctx.fillStyle = c.text; ctx.fillText(ci, lx + 13, 9);
    lx += Math.min(80, m.left + plotW / uniqCI.length + 10);
  }
  if (uniqCI.length > 6) { ctx.fillStyle = c.muted; ctx.fillText(`+${uniqCI.length - 6} ещё`, lx, 9); }

  // time axis
  ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.textBaseline = 'top'; ctx.fillStyle = c.muted;
  const step = Math.max(1, Math.floor(N / Math.floor(plotW / 100)));
  for (let i = 0; i < N; i += step) ctx.fillText(fmtTime(times[i]), m.left + (i / (N - 1 || 1)) * plotW, m.top + rowH + 4);
  if (N > 1) ctx.fillText(fmtTime(times[N - 1]), m.left + plotW, m.top + rowH + 4);
}

// ── Chart: single metric time series ─────────────────────────────────────────
function drawSingleSeries(canvas, points, field, color, refLines, zoom) {
  if (!points.length) { clearCanvas(canvas, 'Нет данных'); return; }
  const z = zoom || { x0: 0, x1: 1 };
  const _n = points.length;
  const _i0 = Math.floor(z.x0 * _n), _i1 = Math.max(_i0 + 2, Math.ceil(z.x1 * _n));
  points = points.slice(_i0, _i1);

  const vals = points.map((p) => p[field]);
  const times = points.map((p) => p.t);
  const finVals = vals.filter(Number.isFinite);
  if (!finVals.length) { clearCanvas(canvas, `Нет данных: ${field}`); return; }

  const yPad = field === 'rsrp' || field === 'rsrq' || field === 'rssi' ? 5 : 2;
  const yMin = Math.floor(arrMin(finVals) / yPad) * yPad - yPad;
  const yMax = Math.ceil(arrMax(finVals)  / yPad) * yPad + yPad;

  const { ctx, c, m, plotW, plotH, toX, cy } = chartBase(canvas, { yMin, yMax, nY: 5, yUnit: ' dB' });
  const N = points.length;

  // handover verticals (CI changes)
  for (let i = 1; i < N; i++) {
    if (points[i].ci && points[i - 1].ci && points[i].ci !== points[i - 1].ci) {
      const x = toX(i, N);
      ctx.strokeStyle = c.handover; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, m.top); ctx.lineTo(x, m.top + plotH); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // series — colored by zone where applicable
  const useZones = ['rsrp', 'rsrq', 'sinr'].includes(field);
  if (useZones) {
    for (let i = 1; i < N; i++) {
      if (!Number.isFinite(vals[i]) || !Number.isFinite(vals[i - 1])) continue;
      ctx.strokeStyle = metricZoneColor(field, vals[i]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(i - 1, N), cy(vals[i - 1]));
      ctx.lineTo(toX(i,     N), cy(vals[i]));
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); let first = true;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(vals[i])) { first = true; continue; }
      first ? ctx.moveTo(toX(i, N), cy(vals[i])) : ctx.lineTo(toX(i, N), cy(vals[i]));
      first = false;
    }
    ctx.stroke();
  }

  for (const rl of (refLines || [])) {
    const yr = m.top + plotH - ((rl.y - yMin) / (yMax - yMin)) * plotH;
    if (yr >= m.top - 2 && yr <= m.top + plotH + 2) drawRefLine(ctx, m, plotW, yr, rl.label, rl.color);
  }

  drawTimeAxis(ctx, c, m, plotW, plotH, times);
}

// ── Chart: distribution bar chart (PCI / CI) ─────────────────────────────────
function drawDistribution(canvas, entries, xlabel, zoom) {
  if (!entries || !entries.length) { clearCanvas(canvas, 'Нет данных'); return; }
  const z = zoom || { x0: 0, x1: 1 };
  const _i0 = Math.floor(z.x0 * entries.length), _i1 = Math.max(_i0 + 1, Math.ceil(z.x1 * entries.length));
  const visible = entries.slice(_i0, _i1);

  const maxCount = arrMax(visible.map((e) => e[1])) || 1;
  const { ctx, c, m, plotW, plotH } = chartBase(canvas, { yMin: 0, yMax: maxCount, nY: 4, yUnit: '' });
  const palette = ['#3b82f6','#f59e0b','#10b981','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899'];
  const bw = plotW / visible.length;

  visible.forEach(([label, count], i) => {
    const bh = (count / maxCount) * plotH;
    const bx = m.left + i * bw;
    ctx.fillStyle = palette[i % palette.length];
    ctx.globalAlpha = 0.75;
    ctx.fillRect(bx + 1, m.top + plotH - bh, bw - 2, bh);
    ctx.globalAlpha = 1;

    // count label on top of bar
    if (bw > 14) {
      ctx.font = '9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = c.muted;
      ctx.fillText(count, bx + bw / 2, m.top + plotH - bh - 1);
    }

    // X label
    if (bw > 18) {
      ctx.font = '9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = c.muted;
      ctx.fillText(String(label).slice(0, 10), bx + bw / 2, m.top + plotH + 4);
    }
  });

  if (xlabel) {
    ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = c.muted; ctx.textBaseline = 'top';
    ctx.fillText(xlabel + ' →', m.left + plotW / 2, m.top + plotH + 20);
  }
}

// ── Chart: PCI color-band timeline ───────────────────────────────────────────
function drawPciColorBands(canvas, pciTimeline, zoom) {
  if (!pciTimeline.length) { clearCanvas(canvas, 'Нет данных'); return; }
  const z = zoom || { x0: 0, x1: 1 };
  const _n = pciTimeline.length;
  const _i0 = Math.floor(z.x0 * _n), _i1 = Math.max(_i0 + 2, Math.ceil(z.x1 * _n));
  const points = pciTimeline.slice(_i0, _i1);

  const ctx = canvas.getContext('2d');
  const c = themeColors();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);

  const palette = ['#3b82f6','#f59e0b','#10b981','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899'];
  const uniqPci = [...new Set(points.map((p) => p.pci).filter(Boolean))];
  const pciColor = (pci) => palette[uniqPci.indexOf(pci) % palette.length] || c.muted;

  const m = { top: 20, right: 20, bottom: 36, left: 10 };
  const plotW = W - m.left - m.right;
  const rowH = H - m.top - m.bottom;
  const N = points.length;

  for (let i = 0; i < N; i++) {
    const x0 = m.left + (i / N) * plotW;
    const x1 = m.left + ((i + 1) / N) * plotW;
    ctx.fillStyle = pciColor(points[i].pci);
    ctx.globalAlpha = 0.78;
    ctx.fillRect(x0, m.top, x1 - x0 + 0.5, rowH);
  }
  ctx.globalAlpha = 1;

  for (let i = 1; i < N; i++) {
    if (points[i].pci !== points[i - 1].pci && points[i].pci) {
      const x = m.left + (i / N) * plotW;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, m.top); ctx.lineTo(x, m.top + rowH); ctx.stroke();
    }
  }

  // legend
  let lx = m.left; ctx.font = '9px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (const pci of uniqPci.slice(0, 8)) {
    ctx.fillStyle = pciColor(pci); ctx.fillRect(lx, 4, 10, 10);
    ctx.fillStyle = c.text; ctx.fillText(`PCI ${pci}`, lx + 13, 9);
    lx += 70;
    if (lx > W - 80) break;
  }

  // time axis
  ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.textBaseline = 'top'; ctx.fillStyle = c.muted;
  const step = Math.max(1, Math.floor(N / Math.floor(plotW / 100)));
  for (let i = 0; i < N; i += step) ctx.fillText(fmtTime(points[i].t), m.left + (i / (N - 1 || 1)) * plotW, m.top + rowH + 4);
  if (N > 1) ctx.fillText(fmtTime(points[N - 1].t), m.left + plotW, m.top + rowH + 4);
}

// ── KPI cards (metric-aware) ──────────────────────────────────────────────────
function kpiCard(label, value, cls) {
  return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value ${cls || ''}">${value}</div></div>`;
}
function pct(v) { return (Number(v || 0) * 100).toFixed(1) + '%'; }
function db(v, digits) { return Number(v || 0).toFixed(digits ?? 1) + ' dB'; }
function dbm(v) { return Number(v || 0).toFixed(1) + ' dBm'; }
function gradeRsrp(v) { return v > -80 ? 'ok' : v > -95 ? 'warn' : 'bad'; }
function gradeRsrq(v) { return v >= -9 ? 'ok' : v >= -14 ? 'warn' : 'bad'; }
function gradeSinr(v) { return v >= 10 ? 'ok' : v >= 0 ? 'warn' : 'bad'; }
function gradePct(v, ok, warn) { return v >= ok ? 'ok' : v >= warn ? 'warn' : 'bad'; }

function renderKpi(kpis, metric) {
  if (!kpis) { el.plotKpi.innerHTML = '<span class="muted">Нет данных</span>'; return; }
  const k = kpis;
  const base = [
    kpiCard('Всего точек',  k.totalSamples.toLocaleString(), ''),
    kpiCard('Хэндоверов',   k.handoverCount, k.handoverCount > 30 ? 'warn' : 'ok'),
  ];

  let specific = [];
  if (metric === 'LteRsrp' || !metric) {
    specific = [
      kpiCard('RSRP P10',  dbm(k.rsrpP10), gradeRsrp(k.rsrpP10)),
      kpiCard('RSRP P50',  dbm(k.rsrpP50), gradeRsrp(k.rsrpP50)),
      kpiCard('RSRP P90',  dbm(k.rsrpP90), gradeRsrp(k.rsrpP90)),
      kpiCard('RSRQ P50',  db(k.rsrqP50),  gradeRsrq(k.rsrqP50)),
      kpiCard('SINR P50',  db(k.sinrP50),  gradeSinr(k.sinrP50)),
      kpiCard('Покрытие ≥ −95 dBm', pct(k.coverageRsrp95),  gradePct(k.coverageRsrp95 * 100, 80, 60)),
      kpiCard('Покрытие ≥ −110 dBm', pct(k.coverageRsrp110), gradePct(k.coverageRsrp110 * 100, 95, 80)),
      kpiCard('SINR ≥ 10 dB', pct(k.qualitySinr10), gradePct(k.qualitySinr10 * 100, 70, 50)),
    ];
  } else if (metric === 'LteRsrq') {
    specific = [
      kpiCard('RSRQ P10', db(k.rsrqP10), gradeRsrq(k.rsrqP10)),
      kpiCard('RSRQ P50', db(k.rsrqP50), gradeRsrq(k.rsrqP50)),
      kpiCard('RSRP P50', dbm(k.rsrpP50), gradeRsrp(k.rsrpP50)),
      kpiCard('SINR P50', db(k.sinrP50),  gradeSinr(k.sinrP50)),
      kpiCard('RSRQ ≥ −9 dB',  pct(k.coverageRsrq9),  gradePct(k.coverageRsrq9 * 100, 80, 60)),
      kpiCard('Хэндоверов / 100 т.', (k.totalSamples > 0 ? (k.handoverCount / k.totalSamples * 100).toFixed(2) : '—'), ''),
    ];
  } else if (metric === 'LteRssnr') {
    specific = [
      kpiCard('SINR P10', db(k.sinrP10), gradeSinr(k.sinrP10)),
      kpiCard('SINR P50', db(k.sinrP50), gradeSinr(k.sinrP50)),
      kpiCard('RSRP P50', dbm(k.rsrpP50), gradeRsrp(k.rsrpP50)),
      kpiCard('RSRQ P50', db(k.rsrqP50),  gradeRsrq(k.rsrqP50)),
      kpiCard('SINR ≥ 0 dB',  pct(k.qualitySinr0),  gradePct(k.qualitySinr0 * 100, 95, 80)),
      kpiCard('SINR ≥ 10 dB', pct(k.qualitySinr10), gradePct(k.qualitySinr10 * 100, 70, 50)),
    ];
  } else if (metric === 'LteRssi') {
    specific = [
      kpiCard('RSSI P50',  db(k.rssiP50), ''),
      kpiCard('RSRP P50',  dbm(k.rsrpP50), gradeRsrp(k.rsrpP50)),
      kpiCard('RSRQ P50',  db(k.rsrqP50),  gradeRsrq(k.rsrqP50)),
    ];
  } else if (metric === 'LtePci') {
    specific = [
      kpiCard('Уникальных PCI', k.uniquePci, k.uniquePci > 8 ? 'warn' : 'ok'),
      kpiCard('Уникальных CI',  k.uniqueCi,  ''),
      kpiCard('Хэндоверов',     k.handoverCount, k.handoverCount > 30 ? 'warn' : 'ok'),
      kpiCard('RSRP P50', dbm(k.rsrpP50), gradeRsrp(k.rsrpP50)),
    ];
  } else if (metric === 'LteCi') {
    specific = [
      kpiCard('Уникальных ячеек', k.uniqueCi, ''),
      kpiCard('Уникальных PCI',   k.uniquePci, ''),
      kpiCard('Хэндоверов', k.handoverCount, k.handoverCount > 30 ? 'warn' : 'ok'),
      kpiCard('RSRP P50',  dbm(k.rsrpP50), gradeRsrp(k.rsrpP50)),
    ];
  }

  el.plotKpi.innerHTML = `<div class="kpi-grid">${[...base, ...specific].join('')}</div>`;
}

// ── Dashboard (time-range only, no operator/cell/metric filters) ──────────────

const DASH_PALETTE = ['#4ea5ff', '#f59e0b', '#8b5cf6', '#34d399', '#f97316', '#ec4899', '#94a3b8'];
const DASH_TECH_COLOR = { LTE: '#4ea5ff', WCDMA: '#34d399', GSM: '#f59e0b' };
const DASH_QUALITY_COLOR = {
  'Отличное': '#16a34a',
  'Хорошее': '#3b82f6',
  'Удовлетворительное': '#d97706',
  'Слабое': '#dc2626'
};

function animateCountUp(node, target, opts) {
  const o = opts || {};
  const duration = o.duration || 700;
  const decimals = o.decimals ?? 0;
  const suffix = o.suffix || '';
  const start = performance.now();
  const from = 0;
  const to = Number.isFinite(target) ? target : 0;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const v = from + (to - from) * ease(t);
    node.textContent = (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('ru')) + suffix;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function drawDonutAnimated(canvas, segments, opts) {
  const ctx = canvas.getContext('2d');
  const c = themeColors();
  const o = opts || {};
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const rOuter = Math.min(W, H) / 2 - 6;
  const rInner = rOuter * 0.6;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;

  const duration = 650;
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const k = ease(t);
    ctx.clearRect(0, 0, W, H);

    let angle = -Math.PI / 2;
    for (const seg of segments) {
      const sweep = (seg.value / total) * Math.PI * 2 * k;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rOuter, angle, angle + sweep);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      angle += sweep;
    }
    // punch the donut hole
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = c.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 18px Inter, system-ui, sans-serif';
    ctx.fillText(Math.round(total * k).toLocaleString('ru'), cx, cy - 8);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = c.muted;
    ctx.fillText(o.centerLabel || 'всего', cx, cy + 12);

    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderDonutLegend(node, segments, total) {
  node.innerHTML = segments.map((s) => `
    <div class="dash-legend-item">
      <span class="dash-legend-dot" style="background:${s.color}"></span>
      <span class="dash-legend-label">${esc(s.label)}</span>
      <span class="dash-legend-value">${total ? Math.round(s.value / total * 100) : 0}%</span>
    </div>`).join('');
}

function drawCategoryBarsAnimated(canvas, items) {
  const ctx = canvas.getContext('2d');
  const c = themeColors();
  const W = canvas.width, H = canvas.height;
  const m = { top: 10, right: 16, bottom: 26, left: 16 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const n = items.length || 1;
  const gap = 14;
  const barW = Math.max(8, (plotW - gap * (n - 1)) / n);
  const maxV = Math.max(1, ...items.map((i) => i.value));

  const duration = 650;
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const k = ease(t);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px Inter, system-ui, sans-serif';

    items.forEach((it, i) => {
      const h = (it.value / maxV) * plotH * k;
      const x = m.left + i * (barW + gap);
      const y = m.top + plotH - h;
      const grad = ctx.createLinearGradient(0, y, 0, m.top + plotH);
      grad.addColorStop(0, '#4ea5ff');
      grad.addColorStop(1, 'rgba(78,165,255,.35)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, barW, h, [6, 6, 0, 0]) : ctx.rect(x, y, barW, h);
      ctx.fill();

      ctx.fillStyle = c.text;
      ctx.textAlign = 'center';
      ctx.fillText(it.value.toLocaleString('ru'), x + barW / 2, y - 6);
      ctx.fillStyle = c.muted;
      ctx.fillText(it.label, x + barW / 2, m.top + plotH + 16);
    });

    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function drawTrendAreaAnimated(canvas, trend, bucketMs) {
  const ctx = canvas.getContext('2d');
  const c = themeColors();
  const W = canvas.width, H = canvas.height;
  const m = { top: 14, right: 16, bottom: 26, left: 46 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const n = trend.length;
  if (!n) { clearCanvas(canvas, 'Нет данных'); return; }

  const maxV = Math.max(1, ...trend.map((p) => p.count));
  const toX = (i) => m.left + (i / Math.max(n - 1, 1)) * plotW;
  const toY = (v) => m.top + plotH - (v / maxV) * plotH;
  const fmt = bucketMs >= 24 * 3600 * 1000
    ? (ts) => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; }
    : fmtTime;

  const duration = 750;
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const k = ease(t);
    ctx.clearRect(0, 0, W, H);

    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = maxV * i / 4;
      const y = toY(v);
      ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.left, y); ctx.lineTo(m.left + plotW, y); ctx.stroke();
      ctx.fillStyle = c.muted;
      ctx.fillText(Math.round(v), m.left - 6, y);
    }

    const visibleN = Math.max(2, Math.round(n * k));
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(trend[0].count));
    for (let i = 1; i < visibleN; i++) ctx.lineTo(toX(i), toY(trend[i].count));
    const lastX = toX(visibleN - 1);
    ctx.lineTo(lastX, m.top + plotH);
    ctx.lineTo(toX(0), m.top + plotH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, m.top, 0, m.top + plotH);
    grad.addColorStop(0, 'rgba(78,165,255,.35)');
    grad.addColorStop(1, 'rgba(78,165,255,.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(toX(0), toY(trend[0].count));
    for (let i = 1; i < visibleN; i++) ctx.lineTo(toX(i), toY(trend[i].count));
    ctx.strokeStyle = '#4ea5ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = c.muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.floor(n / Math.floor(plotW / 70)));
    for (let i = 0; i < n; i += step) ctx.fillText(fmt(trend[i].t), toX(i), m.top + plotH + 6);

    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderDashboard(dash) {
  if (!dash || !dash.total) {
    el.dashboardRangeBadge.textContent = 'нет данных за период';
    el.dashKpis.innerHTML = '<span class="muted">Нет данных за выбранный период</span>';
    [el.dashTechDonut, el.dashOperatorDonut, el.dashQualityDonut].forEach((cv) => clearCanvas(cv, 'Нет данных'));
    clearCanvas(el.dashTrendChart, 'Нет данных');
    clearCanvas(el.dashTopCellsChart, 'Нет данных');
    return;
  }

  const fmtDate = (ts) => Number.isFinite(ts) ? new Date(ts).toLocaleDateString('ru') : '—';
  el.dashboardRangeBadge.textContent = `${fmtDate(dash.minT)} — ${fmtDate(dash.maxT)} · все операторы`;

  // KPI cards with count-up animation
  const kpiDefs = [
    { label: 'Всего измерений', value: dash.total, decimals: 0 },
    { label: 'Операторов',      value: dash.uniqueOperators, decimals: 0 },
    { label: 'Уникальных сот',  value: dash.uniqueCells, decimals: 0 },
    { label: 'Период, дней',    value: Math.max(1, Math.round((dash.maxT - dash.minT) / 86400000)), decimals: 0 },
    { label: 'Средний RSRP',    value: dash.avgRsrp, decimals: 1, suffix: ' дБм' },
    { label: 'Средний SINR',    value: dash.avgSinr, decimals: 1, suffix: ' дБ' },
  ];
  el.dashKpis.innerHTML = `<div class="kpi-grid">${kpiDefs.map((k, i) =>
    `<div class="kpi-card" style="--i:${i}"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value" id="dashKpiVal${i}"></div></div>`
  ).join('')}</div>`;
  kpiDefs.forEach((k, i) => {
    const node = document.getElementById(`dashKpiVal${i}`);
    if (node && Number.isFinite(k.value)) animateCountUp(node, k.value, { decimals: k.decimals, suffix: k.suffix || '' });
    else if (node) node.textContent = '—';
  });

  // Technology donut
  const techSegs = Object.entries(dash.techCount)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: DASH_TECH_COLOR[label] || '#94a3b8' }));
  drawDonutAnimated(el.dashTechDonut, techSegs, { centerLabel: 'всего' });
  renderDonutLegend(el.dashTechLegend, techSegs, dash.total);

  // Operator donut (top 6 + "other")
  const opEntries = Object.entries(dash.opCount).sort((a, b) => b[1] - a[1]);
  const opTop = opEntries.slice(0, 6);
  const opOtherSum = opEntries.slice(6).reduce((s, [, v]) => s + v, 0);
  const opSegs = opTop.map(([label, value], i) => ({ label, value, color: DASH_PALETTE[i % DASH_PALETTE.length] }));
  if (opOtherSum > 0) opSegs.push({ label: 'другие', value: opOtherSum, color: '#94a3b8' });
  drawDonutAnimated(el.dashOperatorDonut, opSegs, { centerLabel: 'всего' });
  renderDonutLegend(el.dashOperatorLegend, opSegs, dash.total);

  // Quality donut
  const qualSegs = Object.entries(dash.qualityBuckets)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value, color: DASH_QUALITY_COLOR[label] || '#94a3b8' }));
  drawDonutAnimated(el.dashQualityDonut, qualSegs, { centerLabel: 'оценено' });
  renderDonutLegend(el.dashQualityLegend, qualSegs, dash.qualityKnown);

  // Trend over time
  drawTrendAreaAnimated(el.dashTrendChart, dash.trend, dash.bucketMs);

  // Top cells bar chart
  const cellItems = dash.topCells.map(([label, value]) => ({ label, value }));
  drawCategoryBarsAnimated(el.dashTopCellsChart, cellItems);
}

// ── Per-metric chart sets ─────────────────────────────────────────────────────
const METRIC_CHARTS = {
  LteRsrp: (n) => [
    { title: 'RSRP — временной ряд',                   h: 220, fn: (cv) => renderChart(cv, drawSingleSeries, n.points, 'rsrp', '#4ea5ff', [
        { y: -80,  label: '−80 dBm (хорошо)',  color: '#16a34a' },
        { y: -100, label: '−100 dBm (норма)',   color: '#d97706' },
        { y: -110, label: '−110 dBm (плохо)',   color: '#dc2626' },
      ]) },
    { title: 'RSRQ — временной ряд',                   h: 220, fn: (cv) => renderChart(cv, drawSingleSeries, n.points, 'rsrq', '#f59e0b', [
        { y: -9,  label: '−9 dB (норма)',  color: '#d97706' },
        { y: -14, label: '−14 dB (плохо)', color: '#dc2626' },
      ]) },
    { title: 'SINR — временной ряд',                   h: 220, fn: (cv) => renderChart(cv, drawSingleSeries, n.points, 'sinr', '#8b5cf6', [
        { y: 10, label: '10 dB (норма)',    color: '#d97706' },
        { y: 0,  label: '0 dB (критично)',  color: '#dc2626' },
      ]) },
    { title: 'RSRP — гистограмма качества сигнала',    h: 220, fn: (cv) => renderChart(cv, drawHistogram, n.rsrpValues, 'dBm', 'rsrp') },
    { title: 'RSRP — функция распределения (CDF)',      h: 220, fn: (cv) => renderChart(cv, drawCDF, n.rsrpValues) },
    { title: 'RSRP vs SINR — корреляция',              h: 220, fn: (cv) => renderChart(cv, drawScatter, n.scatter, 'RSRP (dBm)', 'SINR (dB)') },
    { title: 'Смена обслуживающей ячейки (CI)',        h: 140, fn: (cv) => renderChart(cv, drawPciTimeline, n.pciTimeline) },
  ],
  LteRsrq: (n) => [
    { title: 'RSRQ — временной ряд',  h: 220, fn: (cv) => renderChart(cv, drawSingleSeries, n.points, 'rsrq', '#f59e0b', [
        { y: -9,  label: '−9 dB (норма)',  color: '#d97706' },
        { y: -14, label: '−14 dB (плохо)', color: '#dc2626' },
      ]) },
    { title: 'RSRQ — гистограмма',   h: 220, fn: (cv) => renderChart(cv, drawHistogram, n.rsrqValues, 'dB', 'rsrq') },
    { title: 'RSRQ — CDF',           h: 220, fn: (cv) => renderChart(cv, drawCDF, n.rsrqValues) },
    { title: 'RSRQ vs RSRP — корреляция', h: 220, fn: (cv) => renderChart(cv, drawScatter, n.rsrqVsRsrp, 'RSRP (dBm)', 'RSRQ (dB)') },
    { title: 'Смена обслуживающей ячейки', h: 140, fn: (cv) => renderChart(cv, drawPciTimeline, n.pciTimeline) },
  ],
  LteRssnr: (n) => [
    { title: 'SINR — временной ряд', h: 220, fn: (cv) => renderChart(cv, drawSingleSeries, n.points, 'sinr', '#8b5cf6', [
        { y: 10, label: '10 dB (норма)',    color: '#d97706' },
        { y: 0,  label: '0 dB (критично)',  color: '#dc2626' },
      ]) },
    { title: 'SINR — гистограмма',   h: 220, fn: (cv) => renderChart(cv, drawHistogram, n.sinrValues, 'dB', 'sinr') },
    { title: 'SINR — CDF',           h: 220, fn: (cv) => renderChart(cv, drawCDF, n.sinrValues) },
    { title: 'RSRP vs SINR — корреляция', h: 220, fn: (cv) => renderChart(cv, drawScatter, n.scatter, 'RSRP (dBm)', 'SINR (dB)') },
    { title: 'Смена обслуживающей ячейки', h: 140, fn: (cv) => renderChart(cv, drawPciTimeline, n.pciTimeline) },
  ],
  LteRssi: (n) => [
    { title: 'RSSI — временной ряд', h: 220, fn: (cv) => renderChart(cv, drawSingleSeries, n.points, 'rssi', '#06b6d4', []) },
    { title: 'RSSI — гистограмма',   h: 220, fn: (cv) => renderChart(cv, drawHistogram, n.rssiValues.length ? n.rssiValues : n.selectedValues, 'dBm', '') },
    { title: 'RSSI — CDF',           h: 220, fn: (cv) => renderChart(cv, drawCDF, n.rssiValues.length ? n.rssiValues : n.selectedValues) },
    { title: 'Смена обслуживающей ячейки', h: 140, fn: (cv) => renderChart(cv, drawPciTimeline, n.pciTimeline) },
  ],
  LtePci: (n) => [
    { title: 'PCI — смена физической ячейки во времени', h: 180, fn: (cv) => renderChart(cv, drawPciColorBands, n.pciTimeline) },
    { title: 'PCI — распределение (количество измерений)', h: 240, fn: (cv) => renderChart(cv, drawDistribution, n.pciDist, 'Physical Cell ID') },
    { title: 'Смена логической ячейки (CI)',              h: 140, fn: (cv) => renderChart(cv, drawPciTimeline, n.pciTimeline) },
  ],
  LteCi: (n) => [
    { title: 'CI — смена обслуживающей ячейки',    h: 180, fn: (cv) => renderChart(cv, drawPciTimeline, n.pciTimeline) },
    { title: 'CI — время на ячейку (dwell time)',  h: 240, fn: (cv) => renderChart(cv, drawDistribution, n.ciDist, 'Cell ID (топ-24 по времени)') },
  ],
  LteCqi: (n) => [
    { title: 'CQI — временной ряд',               h: 220, fn: (cv) => renderChart(cv, drawSingleSeries, n.points, 'cqi', '#10b981', [
        { y: 10, label: 'CQI 10 (хорошо)',    color: '#16a34a' },
        { y: 6,  label: 'CQI 6 (норма)',      color: '#d97706' },
        { y: 3,  label: 'CQI 3 (плохо)',      color: '#dc2626' },
      ]) },
    { title: 'CQI — гистограмма распределения',   h: 220, fn: (cv) => renderChart(cv, drawHistogram, n.cqiValues, '', 'cqi') },
    { title: 'CQI — функция распределения (CDF)', h: 220, fn: (cv) => renderChart(cv, drawCDF, n.cqiValues) },
    { title: 'CQI vs RSRP — корреляция',          h: 220, fn: (cv) => renderChart(cv, drawScatter,
        n.points.filter((p) => Number.isFinite(p.cqi) && Number.isFinite(p.rsrp)).map((p) => ({ x: p.rsrp, y: p.cqi })),
        'RSRP (dBm)', 'CQI') },
  ],
};

function renderChartsForMetric(metric, nemo) {
  const grid = document.getElementById('chartsGrid');
  if (!grid) return;

  // Clear old chart registry entries for dynamic canvases
  for (const cv of [...chartRegistry.keys()]) {
    if (cv.closest && cv.closest('#chartsGrid')) chartRegistry.delete(cv);
  }
  grid.innerHTML = '';

  const configs = (METRIC_CHARTS[metric] || METRIC_CHARTS.LteRsrp)(nemo);
  for (const cfg of configs) {
    const panel = document.createElement('section');
    panel.className = 'panel';
    const h2 = document.createElement('h2');
    h2.textContent = cfg.title;
    panel.appendChild(h2);

    const cv = document.createElement('canvas');
    cv.width = 1200;
    cv.height = cfg.h;
    panel.appendChild(cv);
    grid.appendChild(panel);

    cfg.fn(cv);
  }
}

async function loadMnc() {
  const mnc = await fetchJsonWithDiag(`${API_BASE}/v1/filter/available/mnc`, 'plot:mnc').catch(() => []);
  if (Array.isArray(mnc) && mnc.length) {
    replaceSelectOptions(el.plotMnc, mnc, false);
  }
}

function populateMncCiFromRows(rows) {
  const mncs = [...new Set(rows.map((r) => String(r.mnc || '')).filter(Boolean))];
  if (mncs.length) replaceSelectOptions(el.plotMnc, mncs, false);
  const selMnc = el.plotMnc.value;
  const filtered = rows.filter((r) => !selMnc || String(r.mnc) === selMnc);
  const cis = [...new Set(
    filtered.map((r) => String(r.cell_id || '')).filter((v) => v && v !== '0')
  )].sort((a, b) => Number(a) - Number(b));
  replaceSelectOptions(el.plotCi, cis, true);
  const selCi = el.plotCi.value;
  const bands = [...new Set(
    filtered.filter((r) => !selCi || selCi === 'all' || String(r.cell_id) === selCi)
            .map((r) => String(r.bandwidth || '')).filter(Boolean)
  )].sort((a, b) => Number(a) - Number(b));
  if (bands.length) replaceSelectOptions(el.plotBand, bands, true);
}

async function loadCiBand() {
  const mnc = el.plotMnc.value;
  if (!mnc) return;
  const ci = await fetchJsonWithDiag(`${API_BASE}/v1/filter/available/ci/${encodeURIComponent(mnc)}`, 'plot:ci').catch(() => []);
  if (Array.isArray(ci) && ci.length) {
    replaceSelectOptions(el.plotCi, ci, true);
  }
  const selectedCi = el.plotCi.value;
  const bands = await fetchJsonWithDiag(`${API_BASE}/v1/filter/available/band/${encodeURIComponent(mnc)}/${encodeURIComponent(selectedCi)}`, 'plot:band').catch(() => []);
  if (Array.isArray(bands) && bands.length) {
    replaceSelectOptions(el.plotBand, bands, true);
  }
}

async function loadPlots(opts = {}) {
  const triedFallback = Boolean(opts.triedFallback);
  const timeStart = el.plotStart.value.trim();
  const timeEnd   = el.plotEnd.value.trim();
  const metric    = el.plotMetric.value;
  if (!timeStart || !timeEnd) {
    el.plotInfo.textContent = 'Заполни timeStart/timeEnd';
    return;
  }
  try {
    const rows = await window.observerApi.getRadioPoints(timeStart, timeEnd, 80000);
    if (rows && !Array.isArray(rows) && rows.error) {
      el.plotInfo.textContent = `DB fallback error: ${rows.error}`;
      return;
    }
    const list = Array.isArray(rows) ? rows : (rows?.rows || []);
    populateMncCiFromRows(list);

    // Dashboard depends only on the selected time range — no operator/cell/metric filters
    callWorker('prepareDashboard', { dbRows: list }).then(renderDashboard).catch(() => {});

    const selMnc = el.plotMnc.value;
    const selCi  = el.plotCi.value;
    const filtered = list.filter((r) => {
      if (selMnc && String(r.mnc) !== selMnc) return false;
      if (selCi && selCi !== 'all' && String(r.cell_id) !== selCi) return false;
      return true;
    });
    const nemo  = await callWorker('prepareNemo', { dbRows: filtered, metric });
    const vals  = nemo.selectedValues || [];

    if (!vals.length && !triedFallback) {
      const fallback = await resolveFallbackRangeIso();
      if (fallback) {
        if (window.setPlotTimeRange) window.setPlotTimeRange(fallback.start, fallback.end);
        else { el.plotStart.value = fallback.start; el.plotEnd.value = fallback.end; }
        el.plotInfo.textContent = `auto fallback range: ${fallback.start} .. ${fallback.end}`;
        await loadPlots({ triedFallback: true });
        return;
      }
    }

    el.plotInfo.textContent = nemo.points.length
      ? `points=${nemo.points.length}  metric values=${vals.length}  handovers=${nemo.handovers.length}`
      : 'no points in range';

    state.lastNemo = nemo;
    renderChartsForMetric(metric, nemo);
    renderKpi(nemo.kpis, metric);
  } catch (e) {
    el.plotInfo.textContent = `Ошибка: ${String(e.message || e)}`;
  }
}

let logsInFlight = false;
async function refreshBackendLogs(force = false) {
  if (logsInFlight) return;
  const logsTabActive = document.getElementById('tab-logs')?.classList.contains('active');
  if (!force && !logsTabActive && el.autoLogs.checked) return;

  logsInFlight = true;
  try {
    const source = el.logSource.value;
    let txt = '';
    if (source === 'backend') {
      txt = await window.observerApi.tailBackendLogs(el.backendService.value, Number(el.logLines.value || 250));
    } else {
      txt = await window.observerApi.tailLogs(source, Number(el.logLines.value || 250));
    }
    el.backendLogsView.textContent = txt || 'Пусто';
  } finally {
    logsInFlight = false;
  }
}

function renderTunnel(status) {
  el.tunnelStatus.textContent = `running=${status.running} pid=${status.pid || '-'} startedAt=${status.startedAt || '-'}`;
  el.fwTable.innerHTML = (status.config?.forwards || []).map((f) => `<tr><td>${esc(f.localPort)}</td><td>${esc(f.remoteHost)}</td><td>${esc(f.remotePort)}</td></tr>`).join('');
  el.tHost.value = status.config?.host || '';
  el.tPort.value = status.config?.port || 2222;
  el.tUser.value = status.config?.user || '';
}

async function initTunnel() {
  renderTunnel(await window.observerApi.getTunnelStatus());
  el.saveTunnel.addEventListener('click', async () => {
    renderTunnel(await window.observerApi.setTunnelConfig({
      host: el.tHost.value.trim(),
      port: Number(el.tPort.value),
      user: el.tUser.value.trim(),
      password: el.tPassword.value
    }));
  });

  el.startTunnel.addEventListener('click', async () => {
    await window.observerApi.setTunnelConfig({ password: el.tPassword.value });
    renderTunnel(await window.observerApi.startTunnel());
  });

  el.stopTunnel.addEventListener('click', async () => renderTunnel(await window.observerApi.stopTunnel()));

  el.reconnectTunnel.addEventListener('click', async () => {
    const btn = el.reconnectTunnel;
    btn.disabled = true;
    btn.textContent = '⟳ Отключение…';
    try {
      await window.observerApi.stopTunnel();
      await new Promise((r) => setTimeout(r, 800));
      btn.textContent = '⟳ Подключение…';
      await window.observerApi.setTunnelConfig({ password: el.tPassword.value });
      renderTunnel(await window.observerApi.startTunnel());
    } catch (e) {
      renderTunnel({ running: false, error: String(e) });
    } finally {
      btn.disabled = false;
      btn.textContent = '⟳ Переподключить';
    }
  });
}

async function ensureTunnelRunning() {
  try {
    let st = await window.observerApi.getTunnelStatus();
    if (!st.running) st = await window.observerApi.startTunnel();
    renderTunnel(st);
  } catch (_) {}
}

function setupSnapshotBatching() {
  let timer = null;
  let pending = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    state.snapshot = pending;
    renderTables(pending);
    el.lastUpdate.textContent = `snapshot ${pending.finishedAt || pending.startedAt || new Date().toISOString()}`;
    pending = null;
  };

  window.observerApi.onSnapshotUpdate((snapshot) => {
    pending = snapshot;
    if (timer) return;
    timer = setTimeout(flush, 250);
  });
}


async function init() {
  try {
    initWorker();
    initChartModal();
    await applyEnvConfig();

    const cfg = await window.observerApi.getConfig();
    el.pollInterval.value = cfg.pollIntervalMs;
    el.timeoutMs.value = cfg.timeoutMs;

    el.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) setTab(b.dataset.tab);
    });

    el.applyConfig.addEventListener('click', () => {
      window.observerApi.setConfig({
        pollIntervalMs: Number(el.pollInterval.value),
        timeoutMs: Number(el.timeoutMs.value)
      });
    });

    const first = await window.observerApi.getLastSnapshot();
    if (first) {
      state.snapshot = first;
        renderTables(first);
      el.lastUpdate.textContent = `snapshot ${first.finishedAt || first.startedAt || new Date().toISOString()}`;
    }
    setupSnapshotBatching();

    const savedSession = loadSession();
    applySessionToInputs(savedSession);

    const now = new Date();
    if (!savedSession) {
      // No saved session — use defaults / env config
      const initStart = DEFAULT_RANGE_START || new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const initEnd   = DEFAULT_RANGE_END   || now.toISOString();
      if (window.setMapTimeRange) window.setMapTimeRange(initStart, initEnd);
      else { el.mapStart.value = initStart; el.mapEnd.value = initEnd; }
      if (window.setPlotTimeRange) window.setPlotTimeRange(initStart, initEnd);
      else { el.plotStart.value = initStart; el.plotEnd.value = initEnd; }
    }

    initMap();

    // Restore map viewport from last session
    if (savedSession?.mapLat != null && savedSession?.mapLng != null && savedSession?.mapZoom != null) {
      state.map.setView([savedSession.mapLat, savedSession.mapLng], savedSession.mapZoom, { animate: false });
    }

    el.mapLoad.addEventListener('click', loadMapData);
    el.mapRefreshTiles.addEventListener('click', () => {
      resetTileLayer();
      state.map.invalidateSize();
      updateTileInfo('manual tile refresh');
    });
    el.mapOperator.addEventListener('change', loadMapData);
    [el.mapRsrpMin, el.mapRsrpMax, el.mapRsrqMin, el.mapRsrqMax].forEach((x) => x.addEventListener('change', loadMapData));
    [el.showTrack, el.showHeat, el.showBadZones, el.showHandover, el.showCollision3, el.showCollision6, el.showBaseStations].forEach((x) => x.addEventListener('change', applyLayerToggles));

    el.plotMnc.addEventListener('change', loadCiBand);
    el.plotCi.addEventListener('change', loadCiBand);
    el.plotLoad.addEventListener('click', loadPlots);

    el.logSource.addEventListener('change', refreshBackendLogs);
    el.refreshBackendLogs.addEventListener('click', () => refreshBackendLogs(true));
    el.backendService.addEventListener('change', refreshBackendLogs);
    setInterval(() => { if (el.autoLogs.checked) refreshBackendLogs(); }, 15000);

    // Save session on any meaningful change
    const debouncedSave = (() => { let t; return () => { clearTimeout(t); t = setTimeout(saveSession, 800); }; })();
    [el.mapStart, el.mapEnd, el.plotStart, el.plotEnd,
     el.mapRsrpMin, el.mapRsrpMax, el.mapRsrqMin, el.mapRsrqMax,
     el.mapOperator, el.plotMnc, el.plotCi, el.plotMetric
    ].forEach((x) => x?.addEventListener('change', debouncedSave));
    [el.showTrack, el.showHeat, el.showBadZones, el.showHandover,
     el.showCollision3, el.showCollision6, el.showBaseStations
    ].forEach((x) => x?.addEventListener('change', debouncedSave));
    state.map.on('moveend zoomend', debouncedSave);
    window.addEventListener('beforeunload', saveSession);

    await initTunnel();
    await ensureTunnelRunning();

    // Fire-and-forget: only auto-set dates if no saved session
    if (!savedSession) {
      window.observerApi.getRadioMeta().then((meta) => {
        if (meta && meta.maxIso && Number(meta.count) > 0) {
          const maxTs = Date.parse(meta.maxIso);
          if (Number.isFinite(maxTs)) {
            const autoStart = new Date(maxTs - 2 * 60 * 60 * 1000).toISOString();
            const autoEnd = new Date(maxTs).toISOString();
            if (window.setMapTimeRange) window.setMapTimeRange(autoStart, autoEnd);
            else { el.mapStart.value = autoStart; el.mapEnd.value = autoEnd; }
            if (window.setPlotTimeRange) window.setPlotTimeRange(autoStart, autoEnd);
            else { el.plotStart.value = autoStart; el.plotEnd.value = autoEnd; }
          }
        }
      }).catch(() => {});
    }

    fetchJsonWithDiag(`${API_BASE}/v1/filter/available/mnc`, 'map:mnc').then((mnc) => {
      if (Array.isArray(mnc) && mnc.length) replaceSelectOptions(el.mapOperator, mnc.map(String), true);
    }).catch(() => {});
    loadMnc().catch(() => {});
    loadCiBand().catch(() => {});
    refreshBackendLogs(true);
    loadMapData();
  } catch (e) {
    console.error('init error', e);
  }
}

init();
