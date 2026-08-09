/**
 * DeskLink touch policy (pure, unit-tested).
 *
 * 1 finger:
 *   - Light tap   → left-click under finger
 *   - Drag        → mouse move (trackpad) after slop
 *   - Long-press  → right-click under finger
 * 2 fingers:
 *   - Pinch       → sticky zoom (incremental, no snap-back on release)
 *   - Drag zoomed → pan the local view (look around after zoom)
 *   - Drag at fit → remote scroll
 */

/**
 * Drag (mouse move) only after a clear slide.
 * Keep this HIGH so a light press with tiny jitter never becomes a drag
 * (that was causing jump-without-click).
 */
export const MOVE_SLOP_PX = 36;
/** Light press may jitter — still a click if under this and short enough. */
export const TAP_SLOP_PX = 40;
export const TAP_MAX_MS = 600;
export const LONG_PRESS_MS = 480;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 36;
export const PINCH_FRAME_EPS = 0.02;
export const SCROLL_STEP_PX = 24;
export const VIEW_PAN_MIN_ZOOM = 1.05;
export const TRACKPAD_SENSITIVITY = 1.15;

export type FingerMode = 'mouse' | 'view_pan' | 'scroll' | 'pinch';

export function resolveFingerMode(
  touchCount: number,
  zoom: number,
  frameRatio: number,
  pinchLocked: boolean,
): FingerMode {
  if (touchCount >= 2) {
    if (pinchLocked || Math.abs(frameRatio - 1) > PINCH_FRAME_EPS) {
      return 'pinch';
    }
    if (zoom > VIEW_PAN_MIN_ZOOM) {
      return 'view_pan';
    }
    return 'scroll';
  }
  return 'mouse';
}

/** Frame-to-frame pinch — never recomputes from gesture start (no snap-back). */
export function zoomFromFrameRatio(currentZoom: number, frameRatio: number): number {
  if (!Number.isFinite(frameRatio) || frameRatio <= 0) return clampZoom(currentZoom);
  return clampZoom(currentZoom * frameRatio);
}

export function oneFingerPansView(zoom: number): boolean {
  // When zoomed, 1-finger drag is still mouse move (user clarified).
  // View pan is 2-finger only while zoomed.
  void zoom;
  return false;
}

export function clickMovesCursor(): boolean {
  return false;
}

export function shouldStartCursorMove(movedPx: number): boolean {
  return movedPx > MOVE_SLOP_PX;
}

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
  return Math.max(1, Math.min(4, Math.round(z * 100) / 100));
}

export function zoomFromPinch(startZoom: number, ratio: number): number {
  return clampZoom(startZoom * ratio);
}

export function scrollStepsFromDelta(dyPx: number): number {
  if (Math.abs(dyPx) < 10) return 0;
  return Math.max(-4, Math.min(4, Math.round(dyPx / SCROLL_STEP_PX)));
}

/** Light press on phone → left click (forgiving jitter). */
export function isTap(movedPx: number, durationMs: number): boolean {
  return movedPx <= TAP_SLOP_PX && durationMs > 0 && durationMs <= TAP_MAX_MS;
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
