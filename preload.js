const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('observerApi', {
  getLastSnapshot: () => ipcRenderer.invoke('snapshot:getLast'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (nextConfig) => ipcRenderer.invoke('config:set', nextConfig),
  onSnapshotUpdate: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('snapshot:update', wrapped);
    return () => ipcRenderer.removeListener('snapshot:update', wrapped);
  },
  getTunnelStatus: () => ipcRenderer.invoke('tunnel:get'),
  setTunnelConfig: (cfg) => ipcRenderer.invoke('tunnel:set', cfg),
  startTunnel: () => ipcRenderer.invoke('tunnel:start'),
  stopTunnel: () => ipcRenderer.invoke('tunnel:stop'),
  getTunnelDefaults: () => ipcRenderer.invoke('tunnel:defaults'),
  tailLogs: (file, lines = 200) => ipcRenderer.invoke('logs:tail', { file, lines }),
  tailBackendLogs: (service, lines = 200) => ipcRenderer.invoke('logs:backend', { service, lines }),
  getEnvConfig: () => ipcRenderer.invoke('env:get'),
  getRadioPoints: (startIso, endIso, limit = 20000) => ipcRenderer.invoke('radio:db', { startIso, endIso, limit }),
  getRadioMeta: () => ipcRenderer.invoke('radio:meta'),
  logDiagnostic: (payload) => ipcRenderer.send('diag:log', payload || {})
});
