function normalizeLteRow(row) {
  const l = Array.isArray(row?.lte) ? row.lte[0] : null;
  return {
    t:    Date.parse(row?.CreatedAt || row?.created_at || row?.time || new Date().toISOString()),
    lat:  toNum(row?.latitude),
    lon:  toNum(row?.longitude),
    rsrp: toNum(l?.rsrp),
    rsrq: toNum(l?.rsrq),
    sinr: toNum(l?.rssnr),
    rssi: toNum(l?.rssi),
    mnc:       String(l?.mnc ?? row?.mnc ?? ''),
    ci:        String(l?.ci ?? row?.cell_id ?? row?.ci ?? ''),
    pci:       String(l?.pci ?? row?.phys_cell_id ?? row?.pci ?? ''),
    cqi:       toNum(l?.cqi ?? row?.cqi),
    bandwidth: String(l?.bandwidth ?? row?.bandwidth ?? '')
  };
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeDbRow(row) {
  return {
    t:    Date.parse(row?.time || new Date().toISOString()),
    lat:  toNum(row?.latitude),
    lon:  toNum(row?.longitude),
    rsrp: toNum(row?.rsrp),
    rsrq: toNum(row?.rsrq),
    sinr: toNum(row?.rssnr),
    rssi: toNum(row?.rssi),
    mnc:       String(row?.mnc ?? ''),
    ci:        String(row?.cell_id ?? ''),
    pci:       String(row?.phys_cell_id ?? ''),
    cqi:       toNum(row?.cqi),
    bandwidth: String(row?.bandwidth ?? '')
  };
}

function downsample(arr, max) {
  if (!Array.isArray(arr) || arr.length <= max) return Array.isArray(arr) ? arr : [];
  const step = Math.ceil(arr.length / max);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  return out;
}

function filterPoints(points, filters) {
  const out = [];
  const f = filters || {};
  const op = String(f.operator || 'all');
  const rsrpMin = Number.isFinite(Number(f.rsrpMin)) ? Number(f.rsrpMin) : -140;
  const rsrpMax = Number.isFinite(Number(f.rsrpMax)) ? Number(f.rsrpMax) : -40;
  const rsrqMin = Number.isFinite(Number(f.rsrqMin)) ? Number(f.rsrqMin) : -30;
  const rsrqMax = Number.isFinite(Number(f.rsrqMax)) ? Number(f.rsrqMax) : 0;

  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) continue;
    if (op !== 'all' && String(p.mnc || '') !== op) continue;
    if (Number.isFinite(p.rsrp) && (p.rsrp < rsrpMin || p.rsrp > rsrpMax)) continue;
    if (Number.isFinite(p.rsrq) && (p.rsrq < rsrqMin || p.rsrq > rsrqMax)) continue;
    out.push(p);
  }

  return out;
}

function prepareMap(payload) {
  const qualityRows = Array.isArray(payload?.qualityRows) ? payload.qualityRows : [];
  const dbRows = Array.isArray(payload?.dbRows) ? payload.dbRows : [];
  const rows = qualityRows.length ? qualityRows.map(normalizeLteRow) : dbRows.map(normalizeDbRow);

  const filtered = filterPoints(rows, payload?.filters);
  const points = filtered;

  const badZones = points.filter((p) => Number.isFinite(p.rsrp) && p.rsrp <= -115);

  const handover = downsample(Array.isArray(payload?.handover) ? payload.handover : [], Number(payload?.maxHandover) || 1200);

  const coll3 = downsample(Array.isArray(payload?.coll3) ? payload.coll3 : [], Number(payload?.maxCollisions) || 1200);
  const coll6 = downsample(Array.isArray(payload?.coll6) ? payload.coll6 : [], Number(payload?.maxCollisions) || 1200);

  const bs = downsample(Array.isArray(payload?.bs) ? payload.bs : [], Number(payload?.maxBs) || 600);

  return {
    points,
    badZones,
    handover,
    coll3,
    coll6,
    bs,
    operators: [...new Set(rows.map((p) => String(p.mnc || '')).filter((v) => v && v !== '0'))],
    stats: {
      totalRows: rows.length,
      filteredRows: filtered.length,
      renderPoints: points.length,
      badZones: badZones.length,
      handover: handover.length,
      coll3: coll3.length,
      coll6: coll6.length,
      bs: bs.length
    }
  };
}

function getMetricFromRow(row, metric) {
  const key = String(metric || '').toLowerCase().replace('lte', '');
  const l = Array.isArray(row?.lte) ? row.lte[0] : null;
  if (!l) return NaN;
  const map = {
    rsrp:  toNum(l.rsrp),
    rsrq:  toNum(l.rsrq),
    rssnr: toNum(l.rssnr),
    rssi:  toNum(l.rssi),
    pci:   toNum(l.pci),
    ci:    toNum(l.ci)
  };
  return toNum(map[key]);
}

function preparePlot(payload) {
  const metric = String(payload?.metric || 'LteRsrp');
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const values = [];

  for (const row of rows) {
    const v = getMetricFromRow(row, metric);
    if (Number.isFinite(v)) values.push(v);
  }

  return { values };
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function prepareNemo(payload) {
  const rows = Array.isArray(payload?.dbRows) ? payload.dbRows : [];
  const parsed = rows.map(normalizeDbRow).filter((x) => Number.isFinite(x.t));
  parsed.sort((a, b) => a.t - b.t);

  const rsrp = parsed.map((x) => x.rsrp).filter(Number.isFinite);
  const rsrq = parsed.map((x) => x.rsrq).filter(Number.isFinite);
  const sinr = parsed.map((x) => x.sinr).filter(Number.isFinite);

  const rsrpSorted = [...rsrp].sort((a, b) => a - b);
  const rsrqSorted = [...rsrq].sort((a, b) => a - b);
  const sinrSorted = [...sinr].sort((a, b) => a - b);

  const handovers = [];
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].ci && parsed[i - 1].ci && parsed[i].ci !== parsed[i - 1].ci) {
      handovers.push({ i, t: parsed[i].t, fromCi: parsed[i - 1].ci, toCi: parsed[i].ci });
    }
  }

  const rssi = parsed.map((x) => x.rssi).filter(Number.isFinite);
  const cqi  = parsed.map((x) => x.cqi).filter(Number.isFinite);

  const scatter = parsed
    .filter((x) => Number.isFinite(x.rsrp) && Number.isFinite(x.sinr))
    .map((x) => ({ x: x.rsrp, y: x.sinr }));

  const rsrqVsRsrp = parsed
    .filter((x) => Number.isFinite(x.rsrq) && Number.isFinite(x.rsrp))
    .map((x) => ({ x: x.rsrp, y: x.rsrq }));

  const metric = String(payload?.metric || 'LteRsrp');
  const keyMap = { LteRsrp: 'rsrp', LteRsrq: 'rsrq', LteRssnr: 'sinr', LteRssi: 'rssi', LtePci: 'pci', LteCi: 'ci' };
  const k = keyMap[metric] || 'rsrp';
  const selectedValues = parsed.map((x) => Number(x[k])).filter(Number.isFinite);

  // CI timeline
  const uniqCi = [...new Set(parsed.map((x) => x.ci).filter(Boolean))];
  const ciToIndex = new Map(uniqCi.map((ci, i) => [ci, i]));

  // PCI color index
  const uniqPci = [...new Set(parsed.map((x) => x.pci).filter(Boolean))];
  const pciToIndex = new Map(uniqPci.map((pci, i) => [pci, i]));

  const pciTimeline = parsed.map((x) => ({
    t:      x.t,
    ci:     x.ci,
    pci:    x.pci,
    idx:    ciToIndex.has(x.ci)  ? ciToIndex.get(x.ci)   : -1,
    pciIdx: pciToIndex.has(x.pci) ? pciToIndex.get(x.pci) : -1
  }));

  // Distribution maps (label -> count)
  const pciDistMap = {};
  const ciDistMap  = {};
  parsed.forEach((x) => {
    if (x.pci) pciDistMap[x.pci] = (pciDistMap[x.pci] || 0) + 1;
    if (x.ci)  ciDistMap[x.ci]   = (ciDistMap[x.ci]   || 0) + 1;
  });
  const pciDist = Object.entries(pciDistMap).sort((a, b) => Number(a[0]) - Number(b[0]));
  const ciDist  = Object.entries(ciDistMap).sort((a, b) => b[1] - a[1]).slice(0, 24);

  // Extra percentiles
  const rssiSorted = [...rssi].sort((a, b) => a - b);

  return {
    points: parsed,
    handovers,
    scatter,
    rsrqVsRsrp,
    selectedValues,
    rsrpValues:  rsrp,
    rsrqValues:  rsrq,
    sinrValues:  sinr,
    rssiValues:  rssi,
    cqiValues:   cqi,
    pciDist,
    ciDist,
    pciTimeline,
    kpis: {
      totalSamples:    parsed.length,
      handoverCount:   handovers.length,
      uniquePci:       uniqPci.length,
      uniqueCi:        uniqCi.length,
      rsrpP50:         percentile(rsrpSorted, 50),
      rsrpP90:         percentile(rsrpSorted, 90),
      rsrpP10:         percentile(rsrpSorted, 10),
      rsrqP50:         percentile(rsrqSorted, 50),
      rsrqP10:         percentile(rsrqSorted, 10),
      sinrP50:         percentile(sinrSorted, 50),
      sinrP10:         percentile(sinrSorted, 10),
      rssiP50:         percentile(rssiSorted, 50),
      coverageRsrp95:  rsrp.length  ? rsrp.filter((v) => v >= -95).length  / rsrp.length  : 0,
      coverageRsrp110: rsrp.length  ? rsrp.filter((v) => v >= -110).length / rsrp.length  : 0,
      coverageRsrq9:   rsrq.length  ? rsrq.filter((v) => v >= -9).length   / rsrq.length  : 0,
      qualitySinr10:   sinr.length  ? sinr.filter((v) => v >= 10).length   / sinr.length  : 0,
      qualitySinr0:    sinr.length  ? sinr.filter((v) => v >= 0).length    / sinr.length  : 0
    }
  };
}

self.onmessage = (event) => {
  const msg = event?.data || {};
  const reqId = msg.reqId;
  try {
    if (msg.type === 'prepareMap') {
      self.postMessage({ reqId, ok: true, data: prepareMap(msg.payload) });
      return;
    }
    if (msg.type === 'preparePlot') {
      self.postMessage({ reqId, ok: true, data: preparePlot(msg.payload) });
      return;
    }
    if (msg.type === 'prepareNemo') {
      self.postMessage({ reqId, ok: true, data: prepareNemo(msg.payload) });
      return;
    }
    self.postMessage({ reqId, ok: false, error: `Unknown worker message type: ${String(msg.type || '')}` });
  } catch (e) {
    self.postMessage({ reqId, ok: false, error: String(e?.message || e) });
  }
};
