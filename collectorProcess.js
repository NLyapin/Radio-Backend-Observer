const { Collector, DEFAULT_CONFIG } = require('./collector');

let collector = null;
let lastSnapshot = null;

function reply(reqId, ok, data) {
  if (!process.send) return;
  process.send({ type: 'reply', reqId, ok, data });
}

function ensureCollector() {
  if (collector) return;
  collector = new Collector((snapshot) => {
    lastSnapshot = snapshot;
    if (process.send) process.send({ type: 'snapshot', data: snapshot });
  });
  collector.start();
}

process.on('message', (msg) => {
  const type = msg?.type;
  const reqId = msg?.reqId;

  try {
    ensureCollector();

    if (type === 'getConfig') {
      reply(reqId, true, collector.getConfig());
      return;
    }

    if (type === 'setConfig') {
      collector.setConfig(msg?.payload || {});
      reply(reqId, true, collector.getConfig());
      return;
    }

    if (type === 'getLast') {
      reply(reqId, true, lastSnapshot);
      return;
    }

    if (type === 'stop') {
      collector.stop();
      reply(reqId, true, true);
      return;
    }

    if (type === 'start') {
      collector.start();
      reply(reqId, true, true);
      return;
    }

    reply(reqId, false, `Unknown type: ${String(type || '')}`);
  } catch (e) {
    reply(reqId, false, String(e?.message || e));
  }
});

process.on('disconnect', () => {
  try {
    collector?.stop();
  } catch (_) {}
  process.exit(0);
});

ensureCollector();
if (process.send) process.send({ type: 'ready', data: { defaultConfig: DEFAULT_CONFIG } });
