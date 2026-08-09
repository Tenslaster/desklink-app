/**
 * Gesture + quality unit tests (no Jest required).
 * Run: node scripts/test_gestures.mjs
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Compile gestures.ts + storage quality on the fly via TS transpile
function loadTs(rel) {
  const src = readFileSync(join(root, rel), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText);
  const req = createRequire(import.meta.url);
  fn(module.exports, req, module, rel, root);
  return module.exports;
}

const g = loadTs('src/services/gestures.ts');
const storageSrc = readFileSync(join(root, 'src/services/storage.ts'), 'utf8');
// Extract qualityToStream by transpiling full storage (needs mock for native modules)
const storageTranspiled = ts.transpileModule(
  storageSrc
    .replace(/import \* as SecureStore from 'expo-secure-store';/, 'const SecureStore = {};')
    .replace(
      /import AsyncStorage from '@react-native-async-storage\/async-storage';/,
      'const AsyncStorage = { getItem: async () => null, setItem: async () => {} };',
    ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const storageMod = { exports: {} };
new Function(
  'exports',
  'require',
  'module',
  storageTranspiled,
)(storageMod.exports, createRequire(import.meta.url), storageMod);

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
  }
}

console.log('\n=== DeskLink gesture policy tests ===\n');

// 1 finger never pans
assert(g.oneFingerPansView() === false, 'oneFingerPansView() is always false');
assert(g.resolveFingerMode(1, 1, 1) === 'mouse', '1 finger @ fit → mouse');
assert(g.resolveFingerMode(1, 2.5, 1) === 'mouse', '1 finger @ zoomed → mouse (NOT view_pan)');
assert(g.resolveFingerMode(1, 3, 1.5) === 'mouse', '1 finger ignores pinch ratio → mouse');

// 2 fingers
assert(g.resolveFingerMode(2, 1, 1) === 'scroll', '2 fingers @ fit → scroll');
assert(g.resolveFingerMode(2, 2, 1) === 'view_pan', '2 fingers @ zoomed → view_pan');
assert(g.resolveFingerMode(2, 2, 1.2) === 'pinch', '2 fingers large pinch → pinch');
assert(g.resolveFingerMode(2, 1, 0.85) === 'pinch', '2 fingers pinch-out → pinch');

// Zoom helpers
assert(g.clampZoom(0.5) === 1, 'clampZoom floor 1');
assert(g.clampZoom(9) === 4, 'clampZoom ceil 4');
assert(g.zoomFromPinch(1, 2) === 2, 'zoomFromPinch 1*2');

// Pan reset at fit
assert(
  g.panOffsetForZoom(1, { x: 40, y: -20 }).x === 0 &&
    g.panOffsetForZoom(1, { x: 40, y: -20 }).y === 0,
  'pan cleared when zoom fit',
);
assert(g.panOffsetForZoom(2, { x: 40, y: -20 }).x === 40, 'pan kept when zoomed');

// Tap classification
assert(g.isTap(5, 100) === true, 'small move short time = tap');
assert(g.isTap(50, 100) === false, 'large move = not tap');
assert(g.isDoubleTap(100, 10, true) === true, 'double tap window');
assert(g.isDoubleTap(500, 10, true) === false, 'double tap expired');

// Norm mapping center
const c = { x: 0, y: 0, w: 100, h: 100 };
const mid = g.normFromPoint(50, 50, c, 1, { x: 0, y: 0 });
assert(Math.abs(mid.x - 0.5) < 0.01 && Math.abs(mid.y - 0.5) < 0.01, 'center maps to 0.5,0.5');

console.log('\n=== Quality floor tests ===\n');

const presets = ['smooth', 'balanced', 'sharp'];
for (const p of presets) {
  const q = storageMod.exports.qualityToStream(p);
  const errs = g.assertQualityFloor(q);
  assert(errs.length === 0, `preset ${p} meets floor (scale≥0.7 q≥70 fps≥18): ${JSON.stringify(q)}`);
  assert(q.scale >= 0.78, `preset ${p} scale ${q.scale} high enough`);
  assert(q.jpeg_quality >= 76, `preset ${p} jpeg ${q.jpeg_quality} high enough`);
}

console.log('\n--------------------------------');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('--------------------------------\n');
process.exit(failed ? 1 : 0);
