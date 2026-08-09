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
  normFromPoint,
  panOffsetForZoom,
  resolveFingerMode,
  scrollStepsFromDelta,
  shouldStartCursorMove,
  trackpadDelta,
  zoomFromFrameRatio,
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
 * UX (user-confirmed):
 *  • Light tap     → left-click under finger
 *  • 1-finger drag → mouse move (trackpad)
 *  • Pinch         → zoom to see better; STAYS zoomed (no snap-back)
 *  • 2-finger drag while zoomed → pan the view to look around
 *  • 2-finger drag at fit       → remote scroll
 *  • Long-press    → right-click under finger
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
  const lastPinchDist = useRef(0);
  const pinchLocked = useRef(false);
  const twoFingerMid = useRef<{ x: number; y: number } | null>(null);
  const twoFingerOrigin = useRef<{ x: number; y: number } | null>(null);
  const panOffset = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const animPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const touchStart = useRef({ x: 0, y: 0, t: 0, lx: 0, ly: 0 });
  const lastFinger = useRef({ lx: 0, ly: 0 });
  const moved = useRef(false);
  const cursorDriving = useRef(false);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const [hint, setHint] = useState(!!showGestureHint);
  const [badge, setBadge] = useState<string | null>(null);

  useEffect(() => {
    stickyZoom.current = zoom;
  }, [zoom]);

  // Clear pan only when user fully fits (zoom ≈ 1)
  useEffect(() => {
    if (zoom <= VIEW_PAN_MIN_ZOOM) {
      if (panOffset.current.x !== 0 || panOffset.current.y !== 0) {
        panOffset.current = { x: 0, y: 0 };
        animPan.setValue({ x: 0, y: 0 });
      }
    }
  }, [zoom, animPan]);

  useEffect(() => {
    if (!showGestureHint) return;
    const t = setTimeout(() => setHint(false), 6000);
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

  const commitZoom = (z: number) => {
    const next = clampZoom(z);
    stickyZoom.current = next;
    onZoomChange?.(next);
  };

  /** 1-finger drag → mouse move only */
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
  };

  const beginMulti = (e: GestureResponderEvent) => {
    multiTouch.current = true;
    clearLong();
    pinchLocked.current = false;
    lastPinchDist.current = touchDist(e) || 1;
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
            const n = normFromPoint(
              touchStart.current.lx,
              touchStart.current.ly,
              content.current,
              stickyZoom.current,
              panOffset.current,
            );
            cursor.current = n;
            client?.sendPointer('click', n.x, n.y, { button: 'right' });
            setBadge('Right-click');
            setTimeout(() => setBadge(null), 350);
          }, LONG_PRESS_MS);
        },

        onPanResponderMove: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;

          // ── TWO FINGERS: pinch zoom (sticky) + pan view / scroll ──
          if (touches.length >= 2) {
            if (!multiTouch.current) beginMulti(e);

            const d = touchDist(e);
            const prev = lastPinchDist.current > 0 ? lastPinchDist.current : d || 1;
            const frameRatio = d > 0 ? d / prev : 1;

            if (!pinchLocked.current && Math.abs(frameRatio - 1) > 0.02) {
              pinchLocked.current = true;
            }

            const mode = resolveFingerMode(
              2,
              stickyZoom.current,
              frameRatio,
              pinchLocked.current,
            );

            if (mode === 'pinch' && d > 0) {
              // Incremental: release cannot snap zoom back to 1
              commitZoom(zoomFromFrameRatio(stickyZoom.current, frameRatio));
              setBadge(`${Math.round(stickyZoom.current * 100)}%`);
              lastPinchDist.current = d;
            } else if (d > 0) {
              lastPinchDist.current = d;
            }

            // While zoomed: 2-finger drag pans the VIEW (see other parts of desktop)
            if (stickyZoom.current > VIEW_PAN_MIN_ZOOM && twoFingerOrigin.current) {
              const mid = midPoint(e);
              panOffset.current = {
                x: panOrigin.current.x + (mid.x - twoFingerOrigin.current.x),
                y: panOrigin.current.y + (mid.y - twoFingerOrigin.current.y),
              };
              animPan.setValue(panOffset.current);
              if (mode !== 'pinch') setBadge('Look around');
            } else if (mode === 'scroll' && twoFingerMid.current) {
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

          // Dropped to 1 finger after multi — freeze zoom (do not collapse)
          if (multiTouch.current) {
            multiTouch.current = false;
            pinchLocked.current = false;
            twoFingerMid.current = null;
            twoFingerOrigin.current = null;
            lastPinchDist.current = 0;
            onZoomChange?.(stickyZoom.current);
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
            lastPinchDist.current = 0;
            // Keep zoom exactly where pinch left it
            onZoomChange?.(stickyZoom.current);
            if (stickyZoom.current <= VIEW_PAN_MIN_ZOOM) {
              const cleared = panOffsetForZoom(1, panOffset.current);
              panOffset.current = cleared;
              animPan.setValue(cleared);
            }
            setBadge(null);
            cursorDriving.current = false;
            return;
          }

          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          const duration = Date.now() - touchStart.current.t;
          const dist = Math.hypot(pageX - touchStart.current.x, pageY - touchStart.current.y);

          if (longFired.current && !cursorDriving.current) {
            cursorDriving.current = false;
            setBadge(null);
            return;
          }

          // Light press → left click under finger
          if (!cursorDriving.current && isTap(dist, duration)) {
            const n = normFromPoint(
              locationX,
              locationY,
              content.current,
              stickyZoom.current,
              panOffset.current,
            );
            cursor.current = n;
            const now = Date.now();
            const dt = now - lastTap.current.t;
            const tapDist = Math.hypot(pageX - lastTap.current.x, pageY - lastTap.current.y);
            if (isDoubleTap(dt, tapDist, lastTap.current.t > 0)) {
              client?.sendPointer('click', n.x, n.y, { button: 'left' });
              setTimeout(() => client?.sendPointer('click', n.x, n.y, { button: 'left' }), 45);
              lastTap.current = { t: 0, x: 0, y: 0 };
              setBadge('Double-click');
            } else {
              client?.sendPointer('click', n.x, n.y, { button: 'left' });
              lastTap.current = { t: now, x: pageX, y: pageY };
              setBadge('Click');
            }
            setTimeout(() => setBadge(null), 220);
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
          onZoomChange?.(stickyZoom.current);
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
          <Text style={styles.hintTitle}>How to use</Text>
          <Text style={styles.hintLine}>Tap · left-click on the PC</Text>
          <Text style={styles.hintLine}>Drag 1 finger · move mouse</Text>
          <Text style={styles.hintLine}>Pinch · zoom in (stays zoomed)</Text>
          <Text style={styles.hintLine}>2 fingers drag · look around when zoomed</Text>
          <Text style={styles.hintLine}>Toolbar “Fit” · reset zoom</Text>
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
