#!/usr/bin/env node
/**
 * Generates data/synthetic.json from a real DB dump.
 * Usage: node scripts/buildSyntheticData.js <path-to-dump.psv>
 * Dump format (pipe-separated): time|lat|lon|rsrp|rsrq|rssnr|ci|pci|mnc
 */

const fs   = require('fs');
const path = require('path');

const dumpPath = process.argv[2];
if (!dumpPath) { console.error('Usage: node buildSyntheticData.js <dump.psv>'); process.exit(1); }

// ── Real Megafon (MNC=20) cell towers from production DB ──────────────────────
// Format: { ci, pci, lat, lon }  – lat/lon are *approximate* tower positions
// used only for Voronoi cell assignment; the GPS track stays unchanged.
const CELLS = [
  // Real towers from DB (MNC=20, Novosibirsk area)
  { ci: 138553621, pci: 387, lat: 54.990, lon: 82.905 },
  { ci:  97804853, pci: 365, lat: 55.028, lon: 82.922 },
  { ci:  97815823, pci: 209, lat: 54.853, lon: 83.108 },
  { ci:  97815830, pci: 167, lat: 55.018, lon: 82.968 },
  { ci: 138531861, pci: 108, lat: 55.047, lon: 82.956 },
  { ci: 138529803, pci: 286, lat: 55.002, lon: 83.065 },
  // Synthetic Megafon Siberia towers (plausible CI numbers in same range)
  { ci: 138537445, pci: 312, lat: 54.890, lon: 83.025 },
  { ci:  97821034, pci:  78, lat: 55.070, lon: 82.880 },
  { ci: 138542107, pci: 153, lat: 55.145, lon: 82.975 },
  { ci:  97809621, pci: 441, lat: 54.960, lon: 83.180 },
  { ci: 138547893, pci: 225, lat: 55.085, lon: 83.140 },
  { ci:  97826751, pci:  19, lat: 55.200, lon: 83.055 },
  { ci: 138521344, pci: 473, lat: 54.920, lon: 82.840 },
  { ci:  97832108, pci: 332, lat: 55.055, lon: 82.820 },
  { ci: 138558902, pci:  96, lat: 54.875, lon: 83.220 },
];

// ── Seeded pseudo-random (reproducible build) ─────────────────────────────────
let _seed = 0xdeadbeef;
function rand() {
  _seed = (_seed ^ (_seed << 13)) >>> 0;
  _seed = (_seed ^ (_seed >> 17)) >>> 0;
  _seed = (_seed ^ (_seed << 5))  >>> 0;
  return _seed / 0x100000000;
}
function gauss() {
  // Box–Muller
  const u = Math.max(1e-10, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Cell assignment (nearest tower + small random jitter) ─────────────────────
function assignCell(lat, lon) {
  let best = CELLS[0], bestD = Infinity;
  for (const c of CELLS) {
    const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2 + rand() * 0.0015;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ── SINR correlated with RSRP ─────────────────────────────────────────────────
function synthSinr(rsrp) {
  // linear base: maps -44→+18, -110→-8, -140→-20
  const base = (rsrp + 140) / 96 * 38 - 20;
  const sinr = base + gauss() * 4.5;
  return Math.round(Math.max(-23, Math.min(40, sinr)) * 10) / 10;
}

// ── Parse dump ────────────────────────────────────────────────────────────────
const lines = fs.readFileSync(dumpPath, 'utf8').split('\n').filter(Boolean);
console.log(`Parsing ${lines.length} rows...`);

const MNC = 20; // Megafon
const rows = [];

for (const line of lines) {
  const p = line.split('|');
  if (p.length < 6) continue;

  const time = p[0];
  const lat  = parseFloat(p[1]);
  const lon  = parseFloat(p[2]);
  const rsrp = parseInt(p[3], 10);
  const rsrq = parseInt(p[4], 10);
  // p[5] = rssnr (ignore – all 0 in DB)
  // p[6] = ci (0 – synthesize)
  // p[7] = pci (keep if valid, else from cell)
  const realPci = parseInt(p[7], 10);

  if (!isFinite(lat) || !isFinite(lon) || lat < 50 || lon < 50) continue;
  if (!isFinite(rsrp) || rsrp >= 0) continue;

  const cell = assignCell(lat, lon);
  const pci  = (realPci > 0 && realPci < 504) ? realPci : cell.pci;
  const sinr = synthSinr(rsrp);
  const rsrqFinal = (isFinite(rsrq) && rsrq < 0) ? rsrq : Math.round(-12 + gauss() * 4);

  rows.push({ time, lat, lon, rsrp, rsrq: rsrqFinal, sinr, ci: cell.ci, pci, mnc: MNC });
}

rows.sort((a, b) => a.time < b.time ? -1 : 1);

console.log(`Enriched ${rows.length} rows. Writing...`);

const outDir  = path.join(__dirname, '..', 'data');
const outPath = path.join(outDir, 'synthetic.json');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(rows));

console.log(`Done → ${outPath}  (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);
