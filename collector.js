const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const DEFAULT_CONFIG = {
  pollIntervalMs: 15000,
  maxConcurrentHttp: 2,
  httpTargets: [
    { id: 'gateway_metrics', url: 'http://127.0.0.1:13200/api/v1/metrics' },
    { id: 'loki_metrics', url: 'http://127.0.0.1:13310/metrics' },
    { id: 'gateway_health', url: 'http://127.0.0.1:13200/health' },
    { id: 'gateway_root', url: 'http://127.0.0.1:13200/' }
  ],
  tcpTargets: [
    { id: 'gw_http', host: '127.0.0.1', port: 13200 },
    { id: 'auth_grpc', host: '127.0.0.1', port: 13250 },
    { id: 'datafilter_http', host: '127.0.0.1', port: 13210 },
    { id: 'websocket_http', host: '127.0.0.1', port: 13220 },
    { id: 'map_http', host: '127.0.0.1', port: 13215 },
    { id: 'frontend', host: '127.0.0.1', port: 13150 },
    { id: 'loki', host: '127.0.0.1', port: 13310 },
    { id: 'prometheus', host: '127.0.0.1', port: 13290 },
    { id: 'rabbitmq_ui', host: '127.0.0.1', port: 13031 }
  ],
  timeoutMs: 15000,
  topMetricCount: 60
};

class Collector {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.config = { ...DEFAULT_CONFIG };
    this.timer = null;
    this.running = false;
    this.lastSnapshot = null;
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, 'observer.log');
    this.ensureLogDir();
  }

  ensureLogDir() {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch (_err) {
      // ignore
    }
  }

  log(event, data) {
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), event, data });
      fs.appendFileSync(this.logFile, `${line}\n`);
    } catch (_err) {
      // ignore
    }
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.config.pollIntervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  setConfig(nextConfig) {
    this.config = {
      ...this.config,
      ...nextConfig,
      httpTargets: Array.isArray(nextConfig.httpTargets) ? nextConfig.httpTargets : this.config.httpTargets,
      tcpTargets: Array.isArray(nextConfig.tcpTargets) ? nextConfig.tcpTargets : this.config.tcpTargets
    };
    this.log('config:set', this.config);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), this.config.pollIntervalMs);
    }
  }

  getConfig() {
    return this.config;
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }

  async tick() {
    if (this.running) return;
    this.running = true;

    const startedAt = new Date().toISOString();
    this.log('tick:start', { startedAt });

    try {
      const [httpResults, tcpResults] = await Promise.all([
        this.runHttpChecks(),
        this.runTcpChecks()
      ]);

      const parsedMetrics = this.extractPromMetrics(httpResults);
      const snapshot = {
        startedAt,
        finishedAt: new Date().toISOString(),
        settings: {
          pollIntervalMs: this.config.pollIntervalMs,
          timeoutMs: this.config.timeoutMs
        },
        summary: {
          httpTotal: httpResults.length,
          httpOk: httpResults.filter((x) => x.ok).length,
          tcpTotal: tcpResults.length,
          tcpOpen: tcpResults.filter((x) => x.open).length,
          metricsSeries: parsedMetrics.length
        },
        httpResults,
        tcpResults,
        metrics: parsedMetrics
      };

      this.lastSnapshot = snapshot;
      this.log('tick:done', snapshot.summary);
      this.onUpdate(snapshot);
    } catch (error) {
      this.log('tick:error', {
        message: String(error?.message || error),
        stack: String(error?.stack || '')
      });
      this.onUpdate({
        startedAt,
        finishedAt: new Date().toISOString(),
        error: String(error?.message || error),
        summary: { httpTotal: 0, httpOk: 0, tcpTotal: 0, tcpOpen: 0, metricsSeries: 0 },
        httpResults: [],
        tcpResults: [],
        metrics: []
      });
    } finally {
      this.running = false;
    }
  }

  async runHttpChecks() {
    const tasks = this.config.httpTargets.map((target) => () => this.checkHttpTarget(target));
    return runLimited(tasks, this.config.maxConcurrentHttp);
  }

  async checkHttpTarget(target) {
    const started = Date.now();
    const result = {
      id: target.id,
      url: target.url,
      ok: false,
      status: null,
      latencyMs: null,
      contentType: '',
      bodySample: '',
      error: ''
    };

    try {
      this.log('http:start', { id: target.id, url: target.url, timeoutMs: this.config.timeoutMs });
      const response = await requestUrl(target.url, this.config.timeoutMs);
      result.status = response.status;
      result.ok = response.status >= 200 && response.status < 300;
      result.latencyMs = Date.now() - started;
      result.contentType = response.contentType;
      result.bodySample = response.body.slice(0, 5000);
      this.log('http:done', {
        id: target.id,
        status: result.status,
        ok: result.ok,
        latencyMs: result.latencyMs,
        contentType: result.contentType,
        bytes: response.body.length
      });
    } catch (error) {
      result.error = String(error?.message || error);
      result.latencyMs = Date.now() - started;
      this.log('http:error', {
        id: target.id,
        url: target.url,
        error: result.error,
        latencyMs: result.latencyMs
      });
    }

    return result;
  }

  async runTcpChecks() {
    return Promise.all(this.config.tcpTargets.map((target) => checkTcp(target, this.config.timeoutMs)));
  }

  extractPromMetrics(httpResults) {
    const raw = [];

    for (const item of httpResults) {
      if (!item.bodySample || !item.contentType.includes('text/plain')) continue;
      if (!item.bodySample.includes('\n')) continue;

      const lines = item.bodySample.split('\n');
      for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const metric = parts[0];
        const value = Number(parts[parts.length - 1]);
        if (!Number.isFinite(value)) continue;
        raw.push({ source: item.id, metric, value });
      }
    }

    raw.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return raw.slice(0, this.config.topMetricCount);
  }
}

function requestUrl(urlRaw, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const url = new URL(urlRaw);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          Host: url.host,
          Connection: 'close',
          'User-Agent': 'radio-backend-observer/0.1.0',
          Accept: '*/*'
        },
        agent: false,
        rejectUnauthorized: false
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode || 0,
            contentType: String(res.headers['content-type'] || ''),
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.end();
  });
}

async function runLimited(tasks, limit) {
  const out = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const current = idx;
      idx += 1;
      out[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

function checkTcp(target, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();

    const done = (open, error = '') => {
      if (!socket.destroyed) socket.destroy();
      resolve({
        id: target.id,
        host: target.host,
        port: target.port,
        open,
        latencyMs: Date.now() - started,
        error
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, String(err?.message || err)));
    socket.connect(target.port, target.host);
  });
}

module.exports = { Collector, DEFAULT_CONFIG };
