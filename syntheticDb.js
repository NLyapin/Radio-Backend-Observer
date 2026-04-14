/**
 * Synthetic data layer — provides the same interface as the live SSH/kubectl DB
 * queries but serves pre-generated data from data/synthetic.json.
 *
 * Activated via USE_SYNTHETIC_DB=true in .env / environment.
 */

const fs   = require('fs');
const path = require('path');

let _rows = null;

function loadRows() {
  if (_rows) return _rows;
  const p = path.join(__dirname, 'data', 'synthetic.json');
  if (!fs.existsSync(p)) throw new Error(`Synthetic DB not found at ${p}. Run: node scripts/buildSyntheticData.js`);
  _rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  return _rows;
}

/**
 * Returns rows in [startIso, endIso], capped at `limit`.
 * Output shape matches getRadioPointsFromDb() in main.js.
 */
function getRadioPoints(startIso, endIso, limit = 20000) {
  const rows = loadRows();
  const tStart = startIso ? Date.parse(startIso) : 0;
  const tEnd   = endIso   ? Date.parse(endIso)   : Infinity;
  const lim    = Math.max(100, Math.min(80000, Number(limit) || 20000));

  const filtered = [];
  for (const r of rows) {
    const t = Date.parse(r.time);
    if (t >= tStart && t <= tEnd) filtered.push(r);
    if (filtered.length >= lim) break;
  }

  return filtered.map((r) => ({
    time:         r.time,
    latitude:     r.lat,
    longitude:    r.lon,
    rsrp:         r.rsrp,
    rsrq:         r.rsrq,
    rssnr:        r.sinr,   // renderer reads this as sinr
    cell_id:      String(r.ci),
    phys_cell_id: String(r.pci),
    mnc:          String(r.mnc),
  }));
}

/**
 * Returns min/max time and total row count.
 * Output shape matches getRadioMetaFromDb() in main.js.
 */
function getRadioMeta() {
  const rows = loadRows();
  if (!rows.length) return { minIso: '', maxIso: '', count: 0 };
  return {
    minIso: rows[0].time,
    maxIso: rows[rows.length - 1].time,
    count:  rows.length,
  };
}

module.exports = { getRadioPoints, getRadioMeta };
