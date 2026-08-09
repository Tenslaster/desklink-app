/**
 * Pure gesture policy for DeskLink remote canvas.
 * Enterprise trackpad-style pointer (tested, no React deps).
 *
 * 1 finger:
 *   - Tap        → click at CURRENT cursor (never moves cursor first)
 *   - Drag       → move cursor (relative trackpad) only after slop
 *   - Long-press → right-click / button-down at CURRENT cursor (no warp)
 * 2 fingers:
 *   - zoomed → pan local view
 *   - fit    → remote scroll
 *   - pinch  → zoom
 */

export const MOVE_SLOP_PX = 14;
export const LONG_PRESS_MS = 450;
export const DOUBLE_TAP_MS = 280;
export const DOUBLE_TAP_SLOP_PX = 28;
export const PINCH_ZOOM_THRESHOLD = 0.08;
export const SCROLL_STEP_PX = 24;
export const VIEW_PAN_MIN_ZOOM = 1.05;
/** Trackpad sensitivity: 1 = finger pixel ≈ desktop pixel at fit zoom */
export const TRACKPAD_SENSITIVITY = 1.15;

export type FingerMode =
  | 'mouse'
  | 'view_pan'
  | 'scroll'
  | 'pinch';

/** Decide primary mode from touch count + zoom + pinch ratio. */
export function resolveFingerMode(
  touchCount: number,
  zoom: number,
  pinchRatio: number,
): FingerMode {
  if (touchCount >= 2) {
    if (Math.abs(pinchRatio - 1) > PINCH_ZOOM_THRESHOLD) {
      return 'pinch';
    }
    if (zoom > VIEW_PAN_MIN_ZOOM) {
      return 'view_pan';
    }
    return 'scroll';
  }
  return 'mouse';
}

export function oneFingerPansView(): boolean {
  return false;
}

/** Enterprise rule: a tap/click must never relocate the cursor. */
export function clickMovesCursor(): boolean {
  return false;
}

/** Cursor moves only after the finger travels past slop (a real drag). */
export function shouldStartCursorMove(movedPx: number): boolean {
  return movedPx > MOVE_SLOP_PX;
}

/**
 * Relative trackpad step: finger delta in view px → normalized desktop delta.
 * contentW/H = letterboxed desktop rect on the phone; zoom scales sensitivity.
 */
export function trackpadDelta(
  dxPx: number,
  dyPx: number,
  contentW: number,
  contentH: number,
  zoom: number,
  sensitivity: number = TRACKPAD_SENSITIVITY,
): { dx: number; dy: number } {
  const z = Math.max(0.001, zoom);
  const w = Math.max(1, contentW);
  const h = Math.max(1, contentH);
  return {
    dx: (dxPx * sensitivity) / (w * z),
    dy: (dyPx * sensitivity) / (h * z),
  };
}

export function applyTrackpadMove(
  cur: { x: number; y: number },
  dxNorm: number,
  dyNorm: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, cur.x + dxNorm)),
    y: Math.max(0, Math.min(1, cur.y + dyNorm)),
  };
}

export function clampZoom(z: number): number {
  return Math.max(1, Math.min(4, z));
}

export function zoomFromPinch(startZoom: number, ratio: number): number {
  return clampZoom(Math.round(startZoom * ratio * 20) / 20);
}

export function scrollStepsFromDelta(dyPx: number): number {
  if (Math.abs(dyPx) < 10) return 0;
  return Math.max(-4, Math.min(4, Math.round(dyPx / SCROLL_STEP_PX)));
}

export function isTap(movedPx: number, durationMs: number): boolean {
  return movedPx <= MOVE_SLOP_PX && durationMs < LONG_PRESS_MS + 80;
}

export function isDoubleTap(dtMs: number, distPx: number, prevExists: boolean): boolean {
  return prevExists && dtMs < DOUBLE_TAP_MS && distPx < DOUBLE_TAP_SLOP_PX;
}

export function panOffsetForZoom(
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  if (zoom <= VIEW_PAN_MIN_ZOOM) {
    return { x: 0, y: 0 };
  }
  return pan;
}

export function normFromPoint(
  lx: number,
  ly: number,
  content: { x: number; y: number; w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  const cx = content.x + content.w / 2;
  const cy = content.y + content.h / 2;
  const z = Math.max(0.001, zoom);
  const ux = (lx - cx - pan.x) / z + cx;
  const uy = (ly - cy - pan.y) / z + cy;
  const x = (ux - content.x) / content.w;
  const y = (uy - content.y) / content.h;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

export type StreamQuality = { fps: number; scale: number; jpeg_quality: number };

export function assertQualityFloor(q: StreamQuality): string[] {
  const errs: string[] = [];
  if (q.fps < 18) errs.push(`fps too low: ${q.fps}`);
  if (q.scale < 0.7) errs.push(`scale too low (blurry): ${q.scale}`);
  if (q.jpeg_quality < 70) errs.push(`jpeg_quality too low: ${q.jpeg_quality}`);
  return errs;
}
