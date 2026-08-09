import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  StyleSheet,
  View,
  Text,
  GestureResponderEvent,
  PanResponder,
  Animated,
} from 'react-native';
import type { DeskLinkClient } from '../services/DeskLinkClient';
import {
  LONG_PRESS_MS,
  VIEW_PAN_MIN_ZOOM,
  applyTrackpadMove,
  isDoubleTap,
  isTap,
  panOffsetForZoom,
  resolveFingerMode,
  scrollStepsFromDelta,
  shouldStartCursorMove,
  trackpadDelta,
  zoomFromPinch,
} from '../services/gestures';

type Props = {
  uri: string | null;
  client: DeskLinkClient | null;
  screenW: number;
  screenH: number;
  zoom: number;
  onZoomChange?: (z: number) => void;
  compactWait?: boolean;
  showGestureHint?: boolean;
};

/**
 * Enterprise trackpad pointer:
 *  • Tap / click  → click at CURRENT cursor — does NOT move the mouse
 *  • Drag past slop → relative trackpad move
 *  • Long-press   → right-click or hold-drag at CURRENT cursor
 *  • 2 fingers    → pan view (zoomed) / scroll (fit) / pinch zoom
 *  • 1 finger never pans the local stage
 */
function RemoteCanvasImpl({
  uri,
  client,
  screenW,
  screenH,
  zoom,
  onZoomChange,
  compactWait,
  showGestureHint,
}: Props) {
  const layout = useRef({ w: 1, h: 1 });
  const content = useRef({ x: 0, y: 0, w: 1, h: 1 });
  /** Authoritative remote cursor (0–1). Never warp on tap. */
  const cursor = useRef({ x: 0.5, y: 0.5 });
  const multiTouch = useRef(false);
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const twoFingerMid = useRef<{ x: number; y: number } | null>(null);
  const panOffset = useRef({ x: 0, y: 0 });
  const twoFingerPanStart = useRef({ x: 0, y: 0 });
  const animPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const touchStart = useRef({ x: 0, y: 0, t: 0, lx: 0, ly: 0 });
  const lastFinger = useRef({ lx: 0, ly: 0 });
  const moved = useRef(false);
  /** True once past slop — only then we stream move events */
  const cursorDriving = useRef(false);
  const dragging = useRef(false); // left button held (long-press drag)
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const [hint, setHint] = useState(!!showGestureHint);
  const [badge, setBadge] = useState<string | null>(null);

  useEffect(() => {
    const next = panOffsetForZoom(zoom, panOffset.current);
    if (next.x !== panOffset.current.x || next.y !== panOffset.current.y) {
      panOffset.current = next;
      animPan.setValue(next);
    }
  }, [zoom, animPan]);

  useEffect(() => {
    if (!showGestureHint) return;
    const t = setTimeout(() => setHint(false), 5500);
    return () => clearTimeout(t);
  }, [showGestureHint]);

  const aspect = screenW > 0 && screenH > 0 ? screenW / screenH : 16 / 9;

  const recomputeContent = useCallback(() => {
    const { w, h } = layout.current;
    let cw = w;
    let ch = w / aspect;
    if (ch > h) {
      ch = h;
      cw = h * aspect;
    }
    content.current = {
      x: (w - cw) / 2,
      y: (h - ch) / 2,
      w: Math.max(1, cw),
      h: Math.max(1, ch),
    };
  }, [aspect]);

  const onLayout = (e: LayoutChangeEvent) => {
    layout.current = {
      w: e.nativeEvent.layout.width,
      h: e.nativeEvent.layout.height,
    };
    recomputeContent();
  };

  const clearLong = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };

  const touchDist = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    if (t.length < 2) return 0;
    const dx = t[0].pageX - t[1].pageX;
    const dy = t[0].pageY - t[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const midPoint = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    if (t.length < 2) return { x: 0, y: 0 };
    return {
      x: (t[0].pageX + t[1].pageX) / 2,
      y: (t[0].pageY + t[1].pageY) / 2,
    };
  };

  const endLeftDrag = () => {
    if (dragging.current) {
      const c = cursor.current;
      client?.sendPointer('up', c.x, c.y, { button: 'left' });
      dragging.current = false;
      setBadge(null);
    }
  };

  /** Relative trackpad move — only called after slop. */
  const driveCursor = (locationX: number, locationY: number) => {
    const dxPx = locationX - lastFinger.current.lx;
    const dyPx = locationY - lastFinger.current.ly;
    lastFinger.current = { lx: locationX, ly: locationY };
    if (dxPx === 0 && dyPx === 0) return;

    const { dx, dy } = trackpadDelta(
      dxPx,
      dyPx,
      content.current.w,
      content.current.h,
      zoomRef.current,
    );
    cursor.current = applyTrackpadMove(cursor.current, dx, dy);
    client?.sendPointer('move', cursor.current.x, cursor.current.y);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;
          clearLong();
          longFired.current = false;
          moved.current = false;
          cursorDriving.current = false;

          if (touches.length >= 2) {
            multiTouch.current = true;
            endLeftDrag();
            pinchStartDist.current = touchDist(e) || 1;
            pinchStartZoom.current = zoomRef.current;
            twoFingerMid.current = midPoint(e);
            twoFingerPanStart.current = { ...panOffset.current };
            setBadge(zoomRef.current > VIEW_PAN_MIN_ZOOM ? 'Pan view' : 'Scroll');
            return;
          }

          // ── ONE FINGER: do NOT move cursor on touch-down ──
          multiTouch.current = false;
          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          touchStart.current = {
            x: pageX,
            y: pageY,
            t: Date.now(),
            lx: locationX,
            ly: locationY,
          };
          lastFinger.current = { lx: locationX, ly: locationY };
          // Intentionally no sendPointer('move') here — enterprise rule

          longTimer.current = setTimeout(() => {
            if (moved.current || multiTouch.current || cursorDriving.current) return;
            longFired.current = true;
            // Long-press at CURRENT cursor — no warp
            dragging.current = true;
            client?.sendPointer('down', cursor.current.x, cursor.current.y, {
              button: 'left',
            });
            setBadge('Hold');
          }, LONG_PRESS_MS);
        },

        onPanResponderMove: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;

          if (touches.length >= 2) {
            if (!multiTouch.current) {
              multiTouch.current = true;
              clearLong();
              endLeftDrag();
              pinchStartDist.current = touchDist(e) || 1;
              pinchStartZoom.current = zoomRef.current;
              twoFingerMid.current = midPoint(e);
              twoFingerPanStart.current = { ...panOffset.current };
            }

            const d = touchDist(e);
            const ratio = pinchStartDist.current > 0 ? d / pinchStartDist.current : 1;
            const mode = resolveFingerMode(touches.length, zoomRef.current, ratio);

            if (mode === 'pinch') {
              const next = zoomFromPinch(pinchStartZoom.current, ratio);
              onZoomChange?.(next);
              setBadge(`${Math.round(next * 100)}%`);
            }

            if (mode === 'view_pan' || (zoomRef.current > VIEW_PAN_MIN_ZOOM && mode !== 'pinch')) {
              const mid = midPoint(e);
              if (twoFingerMid.current) {
                const dx = mid.x - twoFingerMid.current.x;
                const dy = mid.y - twoFingerMid.current.y;
                panOffset.current = {
                  x: twoFingerPanStart.current.x + dx,
                  y: twoFingerPanStart.current.y + dy,
                };
                animPan.setValue(panOffset.current);
              }
            }

            if (mode === 'scroll' && twoFingerMid.current) {
              const mid = midPoint(e);
              const dy = twoFingerMid.current.y - mid.y;
              const steps = scrollStepsFromDelta(dy);
              if (steps !== 0) {
                client?.sendPointer('scroll', cursor.current.x, cursor.current.y, {
                  dy: steps,
                });
                twoFingerMid.current = mid;
              }
            }
            return;
          }

          if (multiTouch.current) return;

          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          const dist = Math.hypot(pageX - touchStart.current.x, pageY - touchStart.current.y);

          // Until slop: ignore — this is still a potential tap/click (no move)
          if (!cursorDriving.current) {
            if (!shouldStartCursorMove(dist)) {
              return;
            }
            // Crossed slop → start trackpad driving
            cursorDriving.current = true;
            moved.current = true;
            clearLong();
            lastFinger.current = { lx: locationX, ly: locationY };
            if (!dragging.current) setBadge('Move');
            return; // first frame past slop: arm only, no jump
          }

          // Past slop: relative trackpad move
          driveCursor(locationX, locationY);
        },

        onPanResponderRelease: (e: GestureResponderEvent) => {
          clearLong();

          if (multiTouch.current) {
            multiTouch.current = false;
            twoFingerMid.current = null;
            setBadge(null);
            const next = panOffsetForZoom(zoomRef.current, panOffset.current);
            panOffset.current = next;
            animPan.setValue(next);
            cursorDriving.current = false;
            return;
          }

          const { pageX, pageY } = e.nativeEvent;
          const duration = Date.now() - touchStart.current.t;
          const dist = Math.hypot(pageX - touchStart.current.x, pageY - touchStart.current.y);
          const c = cursor.current;

          if (dragging.current) {
            // Long-press release without drag → right-click at CURRENT cursor
            if (!cursorDriving.current && longFired.current) {
              client?.sendPointer('up', c.x, c.y, { button: 'left' });
              dragging.current = false;
              client?.sendPointer('click', c.x, c.y, { button: 'right' });
              setBadge('Right-click');
              setTimeout(() => setBadge(null), 450);
              return;
            }
            endLeftDrag();
            cursorDriving.current = false;
            setBadge(null);
            return;
          }

          // Tap: click WHERE THE CURSOR ALREADY IS — never move first
          if (isTap(dist, duration)) {
            const now = Date.now();
            const dt = now - lastTap.current.t;
            const tapDist = Math.hypot(pageX - lastTap.current.x, pageY - lastTap.current.y);
            if (isDoubleTap(dt, tapDist, lastTap.current.t > 0)) {
              client?.sendPointer('click', c.x, c.y, { button: 'left' });
              client?.sendPointer('click', c.x, c.y, { button: 'left' });
              lastTap.current = { t: 0, x: 0, y: 0 };
              setBadge('Double-click');
              setTimeout(() => setBadge(null), 400);
            } else {
              client?.sendPointer('click', c.x, c.y, { button: 'left' });
              lastTap.current = { t: now, x: pageX, y: pageY };
              // subtle feedback — no "Move"
            }
          }

          cursorDriving.current = false;
          setBadge(null);
        },

        onPanResponderTerminate: () => {
          clearLong();
          endLeftDrag();
          multiTouch.current = false;
          twoFingerMid.current = null;
          cursorDriving.current = false;
          setBadge(null);
        },
      }),
    [client, onZoomChange, animPan],
  );

  return (
    <View style={styles.wrap} onLayout={onLayout} {...pan.panHandlers}>
      <Animated.View
        style={[
          styles.stage,
          {
            transform: [
              { translateX: animPan.x },
              { translateY: animPan.y },
              { scale: zoom },
            ],
          },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="contain" fadeDuration={0} />
        ) : (
          <View style={styles.placeholder} />
        )}
      </Animated.View>

      {badge ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}

      {hint && uri ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintTitle}>Trackpad controls</Text>
          <Text style={styles.hintLine}>Tap · click (cursor stays put)</Text>
          <Text style={styles.hintLine}>Drag · move mouse</Text>
          <Text style={styles.hintLine}>Long-press · right-click</Text>
          <Text style={styles.hintLine}>2 fingers · pan view / scroll / pinch</Text>
        </View>
      ) : null}

      {!uri && !compactWait ? (
        <View style={styles.waitOverlay} pointerEvents="none">
          <View style={styles.waitPill}>
            <View style={styles.dot} />
            <Text style={styles.waitText}>Waiting for screen…</Text>
          </View>
        </View>
      ) : null}
      {!uri && compactWait ? (
        <View style={styles.waitOverlay} pointerEvents="none">
          <Text style={styles.waitSoft}>Receiving first frame…</Text>
        </View>
      ) : null}
    </View>
  );
}

export const RemoteCanvas = memo(RemoteCanvasImpl);

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0e0e10', overflow: 'hidden' },
  stage: { flex: 1 },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, backgroundColor: '#141416' },
  badge: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  badgeText: {
    backgroundColor: 'rgba(32,33,36,0.9)',
    color: '#e8eaed',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    overflow: 'hidden',
  },
  hint: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(32,33,36,0.94)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(138,180,248,0.25)',
  },
  hintTitle: { color: '#8ab4f8', fontWeight: '800', fontSize: 13, marginBottom: 6 },
  hintLine: { color: '#e8eaed', fontSize: 12, lineHeight: 18 },
  waitOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  waitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(32,33,36,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
  },
  waitSoft: { color: '#9aa0a6', fontSize: 13, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#8ab4f8' },
  waitText: { color: '#e8eaed', fontSize: 14, fontWeight: '600' },
});
