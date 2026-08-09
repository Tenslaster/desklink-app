/**
 * DeskLink touch policy (pure, unit-tested).
 *
 * 1 finger:
 *   - Light tap   → left-click at cursor (no jump)
 *   - Drag        → mouse move (trackpad) after slop
 *   - Long-press  → right-click at cursor
 * 2 fingers:
 *   - Pinch       → sticky zoom (from start distance, no snap-back)
 *   - Vertical drag → mouse-wheel scroll (works at any zoom)
 *
 * When zoomed, the view auto-centers on the remote cursor so you always
 * see what you're controlling (no manual pan needed).
 */

/**
 * Drag starts after a short slide — low enough to feel instant,
 * high enough that a light tap never becomes a drag.
 */
export const MOVE_SLOP_PX = 16;
/** Light press may jitter — still a click if under this and short enough. */
export const TAP_SLOP_PX = 40;
export const TAP_MAX_MS = 600;
export const LONG_PRESS_MS = 480;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 36;
/** Larger eps so tiny finger jitter doesn't fight pan/scroll. */
export const PINCH_FRAME_EPS = 0.035;
export const SCROLL_STEP_PX = 16;
/** Slightly easier to start a scroll gesture */
export const SCROLL_DEADZONE_PX = 6;
export const VIEW_PAN_MIN_ZOOM = 1.05;
/** Snappy trackpad feel (was 1.15 — felt like a turtle). */
export const TRACKPAD_SENSITIVITY = 2.45;

export type FingerMode = 'mouse' | 'view_pan' | 'scroll' | 'pinch';

export function resolveFingerMode(
  touchCount: number,
  zoom: number,
  frameRatio: number,
  pinchLocked: boolean,
): FingerMode {
  if (touchCount >= 2) {
    // Once pinching, stay on pinch until release (avoids zoom/pan fighting)
    if (pinchLocked || Math.abs(frameRatio - 1) > PINCH_FRAME_EPS) {
      return 'pinch';
    }
    // 2-finger drag = mouse wheel at any zoom (view auto-follows cursor)
    void zoom;
    return 'scroll';
  }
  return 'mouse';
}

/**
 * Absolute pinch from gesture start — stable, no cumulative float drift.
 * (Frame-to-frame ratios jitter and glitch.)
 */
export function zoomFromPinchStart(startZoom: number, startDist: number, dist: number): number {
  if (!Number.isFinite(startDist) || startDist <= 1) return clampZoom(startZoom);
  if (!Number.isFinite(dist) || dist <= 0) return clampZoom(startZoom);
  return clampZoom(startZoom * (dist / startDist));
}

/** Frame-to-frame pinch — kept for tests / legacy. Prefer zoomFromPinchStart. */
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

/**
 * Map finger pixels → normalized desktop delta.
 * Mild zoom damping only (full /zoom made zoomed control unusable).
 * Light acceleration on faster flicks.
 */
export function trackpadDelta(
  dxPx: number,
  dyPx: number,
  contentW: number,
  contentH: number,
  zoom: number,
  sensitivity: number = TRACKPAD_SENSITIVITY,
): { dx: number; dy: number } {
  const w = Math.max(1, contentW);
  const h = Math.max(1, contentH);
  // Only slightly slower when zoomed so you can still aim fine details
  const zDamp = 1 + Math.max(0, zoom - 1) * 0.28;
  const mag = Math.hypot(dxPx, dyPx);
  const accel = mag > 10 ? 1 + Math.min(1.6, (mag - 10) / 28) : 1;
  const s = sensitivity * accel;
  return {
    dx: (dxPx * s) / (w * zDamp),
    dy: (dyPx * s) / (h * zDamp),
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
  // Finer steps than 0.01 rounding thrash — keep 2 decimals for UI stability
  const c = Math.max(1, Math.min(4, z));
  return Math.round(c * 100) / 100;
}

export function zoomFromPinch(startZoom: number, ratio: number): number {
  return clampZoom(startZoom * ratio);
}

/**
 * Map vertical 2-finger drag to mouse-wheel steps.
 * Positive dy (finger up) → scroll up (content moves up / wheel away) = negative wheel
 * on Windows? Windows: positive WHEEL delta scrolls UP (content down in browser).
 * Host uses dy * WHEEL_DELTA; we send positive for finger-up (natural: content follows finger).
 */
export function scrollStepsFromDelta(dyPx: number): number {
  if (Math.abs(dyPx) < SCROLL_DEADZONE_PX) return 0;
  // Finger moves up → positive steps (scroll up); down → negative
  return Math.max(-8, Math.min(8, Math.round(dyPx / SCROLL_STEP_PX)));
}

/**
 * Where to place the desktop image so a human always sees what they're controlling.
 *
 * Fit (zoom ≈ 1): letterbox the full desktop (normal remote view).
 * Zoomed: enlarge the desktop and pin the *remote mouse* to the phone's
 * center — no RN scale-origin math, just absolute left/top/size.
 *
 * Screen position of cursor = (left + cursor.x * width, top + cursor.y * height)
 * We choose left/top so that equals (layout.w/2, layout.h/2).
 */
export type DesktopViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function viewportForCursor(
  cursor: { x: number; y: number },
  content: { x: number; y: number; w: number; h: number },
  layout: { w: number; h: number },
  zoom: number,
): DesktopViewport {
  const z = clampZoom(zoom);
  const cw = Math.max(1, content.w);
  const ch = Math.max(1, content.h);
  // Not laid out yet — avoid wild coordinates
  if (layout.w < 16 || layout.h < 16) {
    return { left: 0, top: 0, width: cw, height: ch };
  }
  // Fit: full desktop letterboxed (ignore cursor — humans expect a stable desktop)
  if (z <= VIEW_PAN_MIN_ZOOM) {
    return {
      left: content.x,
      top: content.y,
      width: cw,
      height: ch,
    };
  }
  const nx = Math.max(0, Math.min(1, cursor.x));
  const ny = Math.max(0, Math.min(1, cursor.y));
  const width = cw * z;
  const height = ch * z;
  return {
    left: layout.w / 2 - nx * width,
    top: layout.h / 2 - ny * height,
    width,
    height,
  };
}

/** Where the remote cursor lands on the phone after applying a viewport. */
export function projectCursorToScreen(
  cursor: { x: number; y: number },
  vp: DesktopViewport,
): { x: number; y: number } {
  return {
    x: vp.left + Math.max(0, Math.min(1, cursor.x)) * vp.width,
    y: vp.top + Math.max(0, Math.min(1, cursor.y)) * vp.height,
  };
}

/**
 * Human check: when zoomed, projected cursor must sit on the phone center.
 * When fit, desktop must match letterbox content rect.
 */
export function assertViewportHuman(
  cursor: { x: number; y: number },
  content: { x: number; y: number; w: number; h: number },
  layout: { w: number; h: number },
  zoom: number,
  eps: number = 1.5,
): string[] {
  const errs: string[] = [];
  const vp = viewportForCursor(cursor, content, layout, zoom);
  const z = clampZoom(zoom);
  if (z <= VIEW_PAN_MIN_ZOOM) {
    if (Math.abs(vp.left - content.x) > eps) errs.push(`fit left ${vp.left}≠${content.x}`);
    if (Math.abs(vp.top - content.y) > eps) errs.push(`fit top ${vp.top}≠${content.y}`);
    if (Math.abs(vp.width - content.w) > eps) errs.push(`fit w ${vp.width}≠${content.w}`);
    if (Math.abs(vp.height - content.h) > eps) errs.push(`fit h ${vp.height}≠${content.h}`);
    return errs;
  }
  const scr = projectCursorToScreen(cursor, vp);
  const cx = layout.w / 2;
  const cy = layout.h / 2;
  if (Math.abs(scr.x - cx) > eps) errs.push(`cursor screen x ${scr.x.toFixed(1)}≠center ${cx}`);
  if (Math.abs(scr.y - cy) > eps) errs.push(`cursor screen y ${scr.y.toFixed(1)}≠center ${cy}`);
  if (Math.abs(vp.width - content.w * z) > eps) errs.push('width not content*zoom');
  if (Math.abs(vp.height - content.h * z) > eps) errs.push('height not content*zoom');
  return errs;
}

/** @deprecated Use viewportForCursor — kept so old imports don't explode. */
export function panToFollowCursor(
  cursor: { x: number; y: number },
  content: { x: number; y: number; w: number; h: number },
  layout: { w: number; h: number },
  zoom: number,
): { x: number; y: number } {
  const vp = viewportForCursor(cursor, content, layout, zoom);
  if (zoom <= VIEW_PAN_MIN_ZOOM) return { x: 0, y: 0 };
  // Approximate legacy pan (not used by canvas anymore)
  return { x: vp.left - content.x, y: vp.top - content.y };
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
