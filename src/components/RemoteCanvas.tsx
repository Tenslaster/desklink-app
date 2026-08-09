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
  clampZoom,
  isDoubleTap,
  isTap,
  panToFollowCursor,
  resolveFingerMode,
  scrollStepsFromDelta,
  shouldStartCursorMove,
  trackpadDelta,
  zoomFromPinchStart,
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
 * Real-mouse model on a phone:
 *  • Light tap     → left-click WHERE THE CURSOR ALREADY IS (no jump)
 *  • 1-finger drag → move the mouse (trackpad)
 *  • Long-press    → right-click at cursor (no jump)
 *  • Pinch         → sticky zoom; view stays locked on the mouse
 *  • 2-finger drag → mouse-wheel scroll (any zoom level)
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
  const cursor = useRef({ x: 0.5, y: 0.5 });
  const multiTouch = useRef(false);
  /** Local zoom authority during pinch — parent lags by a frame. */
  const stickyZoom = useRef(zoom);
  const pinchStartZoom = useRef(1);
  const pinchStartDist = useRef(0);
  const pinchLocked = useRef(false);
  const twoFingerMid = useRef<{ x: number; y: number } | null>(null);
  const twoFingerOrigin = useRef<{ x: number; y: number } | null>(null);
  const panOffset = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const animPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  /** Animated scale — smooth pinch without React re-render every frame */
  const animZoom = useRef(new Animated.Value(zoom)).current;
  const zoomSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const touchStart = useRef({ x: 0, y: 0, t: 0, lx: 0, ly: 0 });
  const lastFinger = useRef({ lx: 0, ly: 0 });
  const moved = useRef(false);
  const cursorDriving = useRef(false);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const [hint, setHint] = useState(!!showGestureHint);
  const [badge, setBadge] = useState<string | null>(null);

  /** Keep zoomed view locked on the remote cursor (center of phone screen). */
  const followCursor = useCallback(() => {
    const z = stickyZoom.current;
    const pan = panToFollowCursor(cursor.current, content.current, layout.current, z);
    panOffset.current = pan;
    animPan.setValue(pan);
  }, [animPan]);

  // Sync parent zoom → local only when not mid-gesture (avoids snap glitches)
  useEffect(() => {
    if (multiTouch.current || pinchLocked.current) return;
    stickyZoom.current = zoom;
    animZoom.setValue(zoom);
    // Always re-center on cursor when zoom buttons / external zoom change
    followCursor();
  }, [zoom, animZoom, followCursor]);

  useEffect(() => {
    if (!showGestureHint) return;
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, [showGestureHint]);

  useEffect(
    () => () => {
      if (zoomSyncTimer.current) clearTimeout(zoomSyncTimer.current);
    },
    [],
  );

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
    // Re-lock zoom framing after rotation / chrome resize
    if (stickyZoom.current > VIEW_PAN_MIN_ZOOM) {
      followCursor();
    }
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

  /** Apply zoom locally (animated) and debounce parent state. */
  const commitZoom = (z: number) => {
    const next = clampZoom(z);
    stickyZoom.current = next;
    animZoom.setValue(next);
    // Zoom keeps the mouse in the middle of the phone screen
    followCursor();
    if (zoomSyncTimer.current) clearTimeout(zoomSyncTimer.current);
    zoomSyncTimer.current = setTimeout(() => {
      zoomSyncTimer.current = null;
      onZoomChange?.(stickyZoom.current);
    }, 48);
  };

  const flushZoomToParent = () => {
    if (zoomSyncTimer.current) {
      clearTimeout(zoomSyncTimer.current);
      zoomSyncTimer.current = null;
    }
    followCursor();
    onZoomChange?.(stickyZoom.current);
  };

  /** 1-finger drag → mouse move; view follows cursor when zoomed */
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
      stickyZoom.current,
    );
    cursor.current = applyTrackpadMove(cursor.current, dx, dy);
    client?.sendPointer('move', cursor.current.x, cursor.current.y);
    if (stickyZoom.current > VIEW_PAN_MIN_ZOOM) {
      followCursor();
    }
  };

  const beginMulti = (e: GestureResponderEvent) => {
    multiTouch.current = true;
    clearLong();
    pinchLocked.current = false;
    const d = touchDist(e) || 1;
    pinchStartDist.current = d;
    pinchStartZoom.current = stickyZoom.current;
    const mid = midPoint(e);
    twoFingerMid.current = mid;
    twoFingerOrigin.current = mid;
    panOrigin.current = { ...panOffset.current };
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
            beginMulti(e);
            return;
          }

          multiTouch.current = false;
          pinchLocked.current = false;
          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          touchStart.current = {
            x: pageX,
            y: pageY,
            t: Date.now(),
            lx: locationX,
            ly: locationY,
          };
          lastFinger.current = { lx: locationX, ly: locationY };

          longTimer.current = setTimeout(() => {
            if (moved.current || multiTouch.current || cursorDriving.current) return;
            longFired.current = true;
            // Right-click at CURRENT mouse position — do not jump to finger
            const c = cursor.current;
            client?.sendPointer('click', c.x, c.y, { button: 'right' });
            setBadge('Right-click');
            setTimeout(() => setBadge(null), 350);
          }, LONG_PRESS_MS);
        },

        onPanResponderMove: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;

          // ── TWO FINGERS: pinch zoom OR mouse-wheel scroll ──
          if (touches.length >= 2) {
            if (!multiTouch.current) beginMulti(e);

            const d = touchDist(e);
            const base = pinchStartDist.current > 0 ? pinchStartDist.current : d || 1;
            const frameRatio = d > 0 ? d / base : 1;

            if (!pinchLocked.current && Math.abs(frameRatio - 1) > 0.035) {
              pinchLocked.current = true;
              // Re-anchor at lock moment so first pinch step isn't a jump
              pinchStartDist.current = d || base;
              pinchStartZoom.current = stickyZoom.current;
            }

            const mode = resolveFingerMode(
              2,
              stickyZoom.current,
              frameRatio,
              pinchLocked.current,
            );

            if (mode === 'pinch' && d > 0) {
              // Stable absolute pinch from gesture start — no cumulative glitches
              commitZoom(
                zoomFromPinchStart(pinchStartZoom.current, pinchStartDist.current, d),
              );
              setBadge(`${Math.round(stickyZoom.current * 100)}%`);
              return;
            }

            // 2-finger drag = mouse wheel (works at any zoom, including zoomed-in)
            if (mode === 'scroll' && twoFingerMid.current) {
              const mid = midPoint(e);
              const dy = twoFingerMid.current.y - mid.y;
              const steps = scrollStepsFromDelta(dy);
              if (steps !== 0) {
                client?.sendPointer('scroll', cursor.current.x, cursor.current.y, {
                  dy: steps,
                });
                twoFingerMid.current = mid;
                setBadge(steps > 0 ? 'Scroll ↑' : 'Scroll ↓');
              }
            }
            return;
          }

          // Dropped to 1 finger after multi — freeze zoom (do not collapse)
          if (multiTouch.current) {
            multiTouch.current = false;
            pinchLocked.current = false;
            twoFingerMid.current = null;
            twoFingerOrigin.current = null;
            pinchStartDist.current = 0;
            flushZoomToParent();
            setBadge(null);
            return;
          }

          // ── ONE FINGER: drag = mouse move ──
          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          const dist = Math.hypot(pageX - touchStart.current.x, pageY - touchStart.current.y);

          if (!cursorDriving.current) {
            if (!shouldStartCursorMove(dist)) return;
            cursorDriving.current = true;
            moved.current = true;
            clearLong();
            lastFinger.current = { lx: locationX, ly: locationY };
            setBadge('Move mouse');
            return;
          }

          driveCursor(locationX, locationY);
        },

        onPanResponderRelease: (e: GestureResponderEvent) => {
          clearLong();

          if (multiTouch.current) {
            multiTouch.current = false;
            pinchLocked.current = false;
            twoFingerMid.current = null;
            twoFingerOrigin.current = null;
            pinchStartDist.current = 0;
            // Keep zoom exactly where pinch left it; view locked on mouse
            flushZoomToParent();
            setBadge(null);
            cursorDriving.current = false;
            return;
          }

          const { pageX, pageY } = e.nativeEvent;
          const duration = Date.now() - touchStart.current.t;
          const dist = Math.hypot(pageX - touchStart.current.x, pageY - touchStart.current.y);

          if (longFired.current && !cursorDriving.current) {
            cursorDriving.current = false;
            setBadge(null);
            return;
          }

          // Light press → left-click AT THE MOUSE CURSOR (like a real mouse button).
          // Does NOT move/jump the cursor to your finger.
          const wantClick =
            !longFired.current &&
            isTap(dist, duration) &&
            (!cursorDriving.current || dist < 28 || duration < 280);

          if (wantClick) {
            const c = cursor.current;
            const now = Date.now();
            const dt = now - lastTap.current.t;
            const tapDist = Math.hypot(pageX - lastTap.current.x, pageY - lastTap.current.y);
            if (isDoubleTap(dt, tapDist, lastTap.current.t > 0)) {
              client?.sendPointer('click', c.x, c.y, { button: 'left' });
              setTimeout(() => client?.sendPointer('click', c.x, c.y, { button: 'left' }), 50);
              lastTap.current = { t: 0, x: 0, y: 0 };
              setBadge('Double-click');
            } else {
              client?.sendPointer('click', c.x, c.y, { button: 'left' });
              lastTap.current = { t: now, x: pageX, y: pageY };
              setBadge('Click');
            }
            setTimeout(() => setBadge(null), 200);
          }

          cursorDriving.current = false;
          setBadge(null);
        },

        onPanResponderTerminate: () => {
          clearLong();
          multiTouch.current = false;
          pinchLocked.current = false;
          twoFingerMid.current = null;
          twoFingerOrigin.current = null;
          cursorDriving.current = false;
          flushZoomToParent();
          setBadge(null);
        },
      }),
    // client / callbacks — anim refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, onZoomChange, animPan, animZoom, followCursor],
  );

  return (
    <View style={styles.wrap} onLayout={onLayout} {...pan.panHandlers}>
      <Animated.View
        style={[
          styles.stage,
          {
            // Scale around view center first, then pan so the mouse stays centered
            transform: [
              { scale: animZoom },
              { translateX: animPan.x },
              { translateY: animPan.y },
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
          <Text style={styles.hintTitle}>How to use</Text>
          <Text style={styles.hintLine}>Drag · move the mouse</Text>
          <Text style={styles.hintLine}>Tap · left-click (at the mouse, no jump)</Text>
          <Text style={styles.hintLine}>Long-press · right-click at mouse</Text>
          <Text style={styles.hintLine}>Pinch · zoom (stays on the mouse)</Text>
          <Text style={styles.hintLine}>2 fingers · scroll wheel up/down</Text>
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
