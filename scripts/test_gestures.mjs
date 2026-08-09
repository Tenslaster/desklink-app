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

// Trackpad: drag = mouse move; tap = click
assert(g.clickMovesCursor() === false, 'tap does not continuously move cursor');
assert(g.shouldStartCursorMove(5) === false, 'small travel → still a tap');
assert(g.shouldStartCursorMove(20) === true, 'past slop → mouse drag');
const cur0 = { x: 0.5, y: 0.5 };
const dlt = g.trackpadDelta(100, 0, 400, 300, 1);
const cur1 = g.applyTrackpadMove(cur0, dlt.dx, dlt.dy);
assert(cur1.x > 0.5 && cur1.y === 0.5, 'drag right moves mouse x');
// Sensitivity should feel snappy (>> old 1.15)
assert(dlt.dx > 0.5, 'trackpad sensitivity high enough for snappy move');
assert(g.isTap(8, 120) === true, 'light press = tap/click');
assert(g.isTap(50, 120) === false, 'big travel = not tap');

// 1 finger = mouse, never local pan
assert(g.oneFingerPansView(1) === false, '1 finger never pans view');
assert(g.oneFingerPansView(2) === false, '1 finger still mouse when zoomed');
assert(g.resolveFingerMode(1, 1, 1, false) === 'mouse', '1 finger → mouse');
assert(g.resolveFingerMode(1, 2.5, 1, false) === 'mouse', '1 finger zoomed → mouse');

// 2 fingers: scroll at any zoom (view auto-follows cursor); pinch when scaling
assert(g.resolveFingerMode(2, 1, 1, false) === 'scroll', '2f fit → scroll');
assert(g.resolveFingerMode(2, 2, 1, false) === 'scroll', '2f zoomed → scroll (not pan)');
assert(g.resolveFingerMode(2, 2, 1.05, false) === 'pinch', '2f scale change → pinch');
assert(g.resolveFingerMode(2, 1, 1, true) === 'pinch', 'pinch stays locked');

// Zoom follows cursor → pan keeps cursor at screen center
const follow = g.panToFollowCursor(
  { x: 0.5, y: 0.5 },
  { x: 0, y: 0, w: 200, h: 100 },
  { w: 200, h: 100 },
  2,
);
assert(Math.abs(follow.x) < 0.01 && Math.abs(follow.y) < 0.01, 'center cursor → zero pan');
const followCorner = g.panToFollowCursor(
  { x: 0, y: 0 },
  { x: 0, y: 0, w: 200, h: 100 },
  { w: 200, h: 100 },
  2,
);
assert(followCorner.x > 0 && followCorner.y > 0, 'top-left cursor → positive pan to center');
assert(g.scrollStepsFromDelta(40) > 0, 'finger up → scroll up steps');
assert(g.scrollStepsFromDelta(-40) < 0, 'finger down → scroll down steps');

// Sticky pinch from start distance (stable, no cumulative glitch)
const zPinch = g.zoomFromPinchStart(1, 100, 180);
assert(zPinch === 1.8, 'pinch start→dist maps cleanly');
const zHeld = g.zoomFromPinchStart(2, 100, 100);
assert(zHeld === 2, 'same dist keeps zoom (no snap-back)');
assert(g.clampZoom(0.5) === 1, 'clampZoom floor 1');
assert(g.clampZoom(9) === 4, 'clampZoom ceil 4');

// Mild zoom damping — still movable when zoomed
const dltZ = g.trackpadDelta(100, 0, 400, 300, 2);
assert(dltZ.dx > 0.35, 'zoomed trackpad still reasonably fast');

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
