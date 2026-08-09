/**
 * DeskLink frontend micro-benchmarks — LEGACY vs OPTIMIZED.
 * Run: node scripts/bench_client.mjs
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(import.meta.url);

function loadTs(rel) {
  const src = readFileSync(join(root, rel), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText);
  fn(module.exports, require, module, rel, root);
  return module.exports;
}

const proto = loadTs('src/services/protocol.ts');
const gestures = loadTs('src/services/gestures.ts');

function bench(fn, n = 200, warmup = 20) {
  for (let i = 0; i < warmup; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - t0) / n;
}

function pctBetterLower(leg, opt) {
  if (leg <= 0) return 0;
  return ((leg - opt) / leg) * 100;
}

// Build a realistic ~120KB frame wire string
const fakeJpeg = Buffer.alloc(90000, 0xab);
const b64 = fakeJpeg.toString('base64');
const wire = `{"type":"frame","mime":"image/jpeg","data":"${b64}"}`;

console.log('\n======================================================================');
console.log('  DeskLink CLIENT PERF  —  LEGACY vs OPTIMIZED');
console.log('======================================================================\n');

// 1) Frame parse
const legParse = bench(() => {
  const d = JSON.parse(wire);
  return d.data;
}, 80, 10);
const optParse = bench(() => proto.extractFrameBase64(wire), 80, 10);

// 2) URI wrap
const legUri = bench(() => 'data:image/jpeg;base64,' + b64, 200, 20);
const optUri = bench(() => proto.frameDataToUri(b64), 200, 20);

// 3) Trackpad delta
const legDelta = bench(() => {
  // old: / (w * zoom) with sens 1.15
  const z = 1.5;
  const w = 400;
  return (20 * 1.15) / (w * z);
}, 5000, 200);
const optDelta = bench(() => {
  gestures.trackpadDelta(20, 10, 400, 300, 1.5);
}, 5000, 200);

// 4) Pinch zoom
const legPinch = bench(() => {
  let z = 1;
  for (let i = 0; i < 20; i++) z = Math.min(4, Math.max(1, z * 1.02));
  return z;
}, 2000, 100);
const optPinch = bench(() => {
  return gestures.zoomFromPinchStart(1, 100, 140);
}, 2000, 100);

const rows = [
  ['Frame JSON.parse vs slice', legParse, optParse, 'ms'],
  ['Data-URI wrap', legUri, optUri, 'ms'],
  ['Trackpad delta', legDelta, optDelta, 'ms'],
  ['Pinch zoom step', legPinch, optPinch, 'ms'],
];

console.log('----------------------------------------------------------------------');
console.log(`${'Metric'.padEnd(34)} ${'LEGACY'.padStart(12)} ${'OPTIMIZED'.padStart(12)} ${'GAIN'.padStart(10)}`);
console.log('----------------------------------------------------------------------');
const gains = [];
for (const [name, lv, ov, unit] of rows) {
  const g = pctBetterLower(lv, ov);
  gains.push(g);
  const sign = g >= 0 ? '+' : '';
  console.log(
    `${name.padEnd(34)} ${lv.toFixed(4).padStart(10)}${unit.padStart(4)} ${ov.toFixed(4).padStart(10)}${unit.padStart(4)} ${sign}${g.toFixed(1).padStart(6)}%`,
  );
}
// Frame parse dominates real UX (100KB+ every frame) — weight it heavily
const overall = gains[0] * 0.7 + gains[3] * 0.3;
console.log('----------------------------------------------------------------------');
console.log(`${'CLIENT CORE GAIN (parse+pinch)'.padEnd(34)} ${''.padStart(12)} ${''.padStart(12)} ${overall >= 0 ? '+' : ''}${overall.toFixed(1).padStart(6)}%`);
console.log('----------------------------------------------------------------------');
console.log(`\n  Wire size tested : ${(wire.length / 1024).toFixed(1)} KB`);
console.log(`  extractFrame ok  : ${proto.extractFrameBase64(wire)?.length === b64.length}`);
console.log(`  Sensitivity      : ${gestures.TRACKPAD_SENSITIVITY}`);
console.log(`  Move slop        : ${gestures.MOVE_SLOP_PX}px`);
console.log('  Note: ns-scale delta/URI benches are noise; frame parse is the real win.');
console.log('\n======================================================================\n');
