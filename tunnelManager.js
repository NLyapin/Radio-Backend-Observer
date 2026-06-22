const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('ssh2');

const DEFAULT_TUNNEL_CONFIG = {
  host: process.env.SSH_HOST || '',
  user: process.env.SSH_USER || '',
  port: Number(process.env.SSH_PORT) || 22,
  password: process.env.SSH_PASSWORD || '',
  strictHostKeyChecking: false,
  forwards: [
    { localPort: 13000, remoteHost: '127.0.0.1', remotePort: 3000 },
    { localPort: 10000, remoteHost: '127.0.0.1', remotePort: 10000 },
    { localPort: 13200, remoteHost: '127.0.0.1', remotePort: 32000 },
    { localPort: 13210, remoteHost: '127.0.0.1', remotePort: 32010 },
    { localPort: 13220, remoteHost: '127.0.0.1', remotePort: 32020 },
    { localPort: 13250, remoteHost: '127.0.0.1', remotePort: 32050 },
    { localPort: 13215, remoteHost: '127.0.0.1', remotePort: 32150 },
    { localPort: 13150, remoteHost: '127.0.0.1', remotePort: 31500 },
    { localPort: 13310, remoteHost: '127.0.0.1', remotePort: 32310 },
    { localPort: 13290, remoteHost: '127.0.0.1', remotePort: 32090 },
    { localPort: 13031, remoteHost: '127.0.0.1', remotePort: 30301 }
  ]
};

class TunnelManager {
  constructor() {
    this.config = { ...DEFAULT_TUNNEL_CONFIG };
    this.client = null;       // ssh2 Client
    this.servers = [];        // net.Server listeners for each forward
    this.startedAt = null;
    this.logsPath = null;
  }

  setLogsDir(logsDir) {
    this.logsPath = path.join(logsDir, 'ssh-tunnel.out');
    fs.mkdirSync(logsDir, { recursive: true });
  }

  setConfig(next) {
    const safeNext = { ...(next || {}) };
    if (Object.prototype.hasOwnProperty.call(safeNext, 'password') && !String(safeNext.password || '').trim()) {
      delete safeNext.password;
    }
    const merged = {
      ...this.config,
      ...safeNext,
      forwards: Array.isArray(safeNext?.forwards) ? safeNext.forwards : this.config.forwards
    };
    this.config = merged;
    return this.getStatus();
  }

  getRawConfig() {
    return this.config;
  }

  getStatus() {
    return {
      running: Boolean(this.client),
      pid: null,
      startedAt: this.startedAt,
      config: {
        ...this.config,
        password: this.config.password ? '***' : ''
      }
    };
  }

  _log(msg) {
    if (!this.logsPath) return;
    try { fs.appendFileSync(this.logsPath, `[${new Date().toISOString()}] ${msg}\n`); } catch (_) {}
  }

  _closeServers() {
    for (const srv of this.servers) {
      try { srv.close(); } catch (_) {}
    }
    this.servers = [];
  }

  // Open one local TCP server that forwards each connection through the SSH channel
  _forwardPort(sshClient, fwd) {
    return new Promise((resolve, reject) => {
      const srv = net.createServer((sock) => {
        sshClient.forwardOut(
          '127.0.0.1', sock.localPort || fwd.localPort,
          fwd.remoteHost, fwd.remotePort,
          (err, stream) => {
            if (err) { sock.destroy(); return; }
            sock.pipe(stream).pipe(sock);
            stream.on('close', () => sock.destroy());
            sock.on('close', () => stream.destroy());
          }
        );
      });

      srv.listen(fwd.localPort, '127.0.0.1', () => {
        this._log(`forward 127.0.0.1:${fwd.localPort} -> ${fwd.remoteHost}:${fwd.remotePort}`);
        resolve(srv);
      });

      srv.on('error', (err) => {
        this._log(`forward error on port ${fwd.localPort}: ${err.message}`);
        reject(err);
      });
    });
  }

  start() {
    // Stop any existing connection first
    this.stop();

    if (!this.config.password) throw new Error('Password is required to start SSH tunnel');
    if (!this.config.host)     throw new Error('SSH host is required');
    if (!this.config.user)     throw new Error('SSH user is required');

    return new Promise((resolve, reject) => {
      const client = new Client();

      client.on('ready', () => {
        this._log(`connected to ${this.config.host}:${this.config.port}`);
        const forwards = this.config.forwards || [];

        // Open all port-forward servers
        Promise.allSettled(forwards.map((fwd) => this._forwardPort(client, fwd)))
          .then((results) => {
            for (const r of results) {
              if (r.status === 'fulfilled') this.servers.push(r.value);
            }
            this.client = client;
            this.startedAt = new Date().toISOString();
            resolve(this.getStatus());
          });
      });

      client.on('error', (err) => {
        this._log(`ssh error: ${err.message}`);
        this._closeServers();
        this.client = null;
        reject(err);
      });

      client.on('close', () => {
        this._log('connection closed');
        this._closeServers();
        this.client = null;
      });

      client.connect({
        host:           this.config.host,
        port:           Number(this.config.port) || 22,
        username:       this.config.user,
        password:       this.config.password,
        readyTimeout:   15000,
        keepaliveInterval: 10000,
        algorithms: {
          serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ssh-ed25519', 'rsa-sha2-256', 'rsa-sha2-512']
        },
        hostVerifier: this.config.strictHostKeyChecking
          ? undefined
          : () => true   // skip host key check (equivalent to StrictHostKeyChecking=no)
      });
    });
  }

  exec(remoteCmd, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('SSH tunnel is not connected. Please connect first.'));
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Remote command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.client.exec(remoteCmd, (err, stream) => {
        if (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          return reject(err);
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (data) => { stdout += String(data); });
        stream.stderr.on('data', (data) => { stderr += String(data); });
        stream.on('close', (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (code !== 0 && !stdout.trim()) {
            reject(new Error(`Remote command failed (exit ${code}): ${stderr.trim() || 'no output'}`));
          } else {
            resolve(stdout);
          }
        });
      });
    });
  }

  stop() {
    this._closeServers();
    if (this.client) {
      try { this.client.end(); } catch (_) {}
      this.client = null;
    }
    this.startedAt = null;
    return this.getStatus();
  }
}

module.exports = { TunnelManager, DEFAULT_TUNNEL_CONFIG };

