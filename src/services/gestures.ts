/**
 * Pure gesture policy for DeskLink remote canvas.
 * Single source of truth — unit-tested, no React deps.
 *
 * Rules (user requirement):
 *  1 finger  → remote mouse only (never pan the local view)
 *  2 fingers → pan the local view when zoomed; else scroll / pinch-zoom
 */

export const MOVE_SLOP_PX = 12;
export const LONG_PRESS_MS = 420;
export const DOUBLE_TAP_MS = 280;
export const DOUBLE_TAP_SLOP_PX = 28;
export const PINCH_ZOOM_THRESHOLD = 0.08; // |ratio-1| above this → pinch zoom
export const SCROLL_STEP_PX = 24;
export const VIEW_PAN_MIN_ZOOM = 1.05;

export type FingerMode =
  | 'mouse' // 1 finger: cursor / click / drag
  | 'view_pan' // 2 fingers while zoomed: pan local viewport
  | 'scroll' // 2 fingers at fit zoom: remote scroll
  | 'pinch'; // 2 fingers distance change: zoom

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
  // ALWAYS mouse for 1 finger — never local pan
  return 'mouse';
}

/** One finger must never pan the local stage. */
export function oneFingerPansView(): boolean {
  return false;
}

/** Clamp zoom to product limits. */
export function clampZoom(z: number): number {
  return Math.max(1, Math.min(4, z));
}

/** Next zoom from pinch. */
export function zoomFromPinch(startZoom: number, ratio: number): number {
  return clampZoom(Math.round(startZoom * ratio * 20) / 20);
}

/** Scroll wheel steps from two-finger vertical delta (px). */
export function scrollStepsFromDelta(dyPx: number): number {
  if (Math.abs(dyPx) < 10) return 0;
  return Math.max(-4, Math.min(4, Math.round(dyPx / SCROLL_STEP_PX)));
}

/** Tap vs move. */
export function isTap(movedPx: number, durationMs: number): boolean {
  return movedPx <= MOVE_SLOP_PX && durationMs < LONG_PRESS_MS + 80;
}

export function isDoubleTap(
  dtMs: number,
  distPx: number,
  prevExists: boolean,
): boolean {
  return prevExists && dtMs < DOUBLE_TAP_MS && distPx < DOUBLE_TAP_SLOP_PX;
}

/** When zoom returns to fit, pan offset must clear. */
export function panOffsetForZoom(
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  if (zoom <= VIEW_PAN_MIN_ZOOM) {
    return { x: 0, y: 0 };
  }
  return pan;
}

/** Normalize layout point → desktop 0..1 (with zoom + pan). */
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

/** Quality floor checks for stream presets. */
export type StreamQuality = { fps: number; scale: number; jpeg_quality: number };

export function assertQualityFloor(q: StreamQuality): string[] {
  const errs: string[] = [];
  if (q.fps < 18) errs.push(`fps too low: ${q.fps}`);
  if (q.scale < 0.7) errs.push(`scale too low (blurry): ${q.scale}`);
  if (q.jpeg_quality < 70) errs.push(`jpeg_quality too low: ${q.jpeg_quality}`);
  return errs;
}
