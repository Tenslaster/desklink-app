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

type Props = {
  uri: string | null;
  client: DeskLinkClient | null;
  screenW: number;
  screenH: number;
  zoom: number;
  onZoomChange?: (z: number) => void;
  compactWait?: boolean;
  /** Optional gesture mode hint shown once */
  showGestureHint?: boolean;
};

const MOVE_SLOP = 12; // px before touch counts as move (not a tap)
const LONG_PRESS_MS = 420;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SLOP = 28;

/**
 * Enterprise remote-desktop gestures (Chrome Remote Desktop–style):
 * - Finger down/move  → move cursor only (never auto-press)
 * - Quick tap         → left click
 * - Double tap        → double left click
 * - Long press        → right click
 * - Long press + drag → left-button drag (select / window drag)
 * - Two-finger drag   → scroll (or pinch zoom when scale changes)
 * - Zoomed: one finger pans the view; touch does not click through
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
  const lastNorm = useRef({ x: 0.5, y: 0.5 });
  const pinching = useRef(false);
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const twoFingerY = useRef<number | null>(null);
  const panOffset = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const animPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Gesture state
  const touchStart = useRef({ x: 0, y: 0, t: 0, lx: 0, ly: 0 });
  const moved = useRef(false);
  const dragging = useRef(false); // left button held (long-press drag)
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const gestureBusy = useRef(false); // multi-touch consumed this gesture
  const [hint, setHint] = useState(!!showGestureHint);
  const [dragBadge, setDragBadge] = useState<string | null>(null);

  useEffect(() => {
    if (!showGestureHint) return;
    const t = setTimeout(() => setHint(false), 4500);
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

  const normFromLocation = (lx: number, ly: number) => {
    const c = content.current;
    const z = zoomRef.current;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const ox = panOffset.current.x;
    const oy = panOffset.current.y;
    const ux = (lx - cx - ox) / z + cx;
    const uy = (ly - cy - oy) / z + cy;
    const x = (ux - c.x) / c.w;
    const y = (uy - c.y) / c.h;
    const nx = Math.max(0, Math.min(1, x));
    const ny = Math.max(0, Math.min(1, y));
    lastNorm.current = { x: nx, y: ny };
    return lastNorm.current;
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

  const endLeftDrag = (n: { x: number; y: number }) => {
    if (dragging.current) {
      client?.sendPointer('up', n.x, n.y, { button: 'left' });
      dragging.current = false;
      setDragBadge(null);
    }
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;
          clearLong();
          longFired.current = false;
          moved.current = false;
          gestureBusy.current = false;

          if (touches.length >= 2) {
            pinching.current = true;
            gestureBusy.current = true;
            pinchStartDist.current = touchDist(e) || 1;
            pinchStartZoom.current = zoomRef.current;
            twoFingerY.current = (touches[0].pageY + touches[1].pageY) / 2;
            endLeftDrag(lastNorm.current);
            return;
          }

          pinching.current = false;
          panStart.current = { ...panOffset.current };
          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          touchStart.current = {
            x: pageX,
            y: pageY,
            t: Date.now(),
            lx: locationX,
            ly: locationY,
          };

          // Zoomed: pan the viewport only — do not drive remote mouse
          if (zoomRef.current > 1.05) {
            return;
          }

          const n = normFromLocation(locationX, locationY);
          // Cursor follows finger — NEVER press on touch-down
          client?.sendPointer('move', n.x, n.y);

          longTimer.current = setTimeout(() => {
            if (moved.current || gestureBusy.current || pinching.current) return;
            if (zoomRef.current > 1.05) return;
            longFired.current = true;
            // Long-press without move → enter left-drag mode (enterprise RD pattern)
            // Quick release without move after long press fires right-click on release if no drag
            dragging.current = true;
            client?.sendPointer('down', lastNorm.current.x, lastNorm.current.y, {
              button: 'left',
            });
            setDragBadge('Drag');
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (e: GestureResponderEvent, g) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2 || pinching.current) {
            gestureBusy.current = true;
            clearLong();
            endLeftDrag(lastNorm.current);
            const d = touchDist(e);
            if (d > 0 && pinchStartDist.current > 0) {
              const ratio = d / pinchStartDist.current;
              // Prefer scroll if fingers mostly translate; pinch if scale changes a lot
              if (Math.abs(ratio - 1) > 0.08) {
                const next = Math.max(1, Math.min(4, pinchStartZoom.current * ratio));
                onZoomChange?.(Math.round(next * 20) / 20);
              }
            }
            if (zoomRef.current <= 1.05 && touches.length >= 2) {
              const midY = (touches[0].pageY + touches[1].pageY) / 2;
              if (twoFingerY.current != null) {
                const dy = twoFingerY.current - midY;
                if (Math.abs(dy) > 10) {
                  const steps = Math.max(-4, Math.min(4, Math.round(dy / 24)));
                  if (steps !== 0) {
                    const n = lastNorm.current;
                    client?.sendPointer('scroll', n.x, n.y, { dy: steps });
                    twoFingerY.current = midY;
                  }
                }
              }
            }
            return;
          }

          if (zoomRef.current > 1.05) {
            panOffset.current = {
              x: panStart.current.x + g.dx,
              y: panStart.current.y + g.dy,
            };
            animPan.setValue(panOffset.current);
            return;
          }

          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          const dx = pageX - touchStart.current.x;
          const dy = pageY - touchStart.current.y;
          if (!moved.current && Math.hypot(dx, dy) > MOVE_SLOP) {
            moved.current = true;
            clearLong();
            // If we already started a long-press drag, keep dragging.
            // Otherwise this is pure cursor move — no button.
            if (!dragging.current) {
              setDragBadge(null);
            }
          }

          const n = normFromLocation(locationX, locationY);
          if (dragging.current) {
            // Button already down — stream moves (client throttles)
            client?.sendPointer('move', n.x, n.y);
          } else {
            client?.sendPointer('move', n.x, n.y);
          }
        },
        onPanResponderRelease: (e: GestureResponderEvent) => {
          clearLong();
          if (pinching.current) {
            pinching.current = false;
            twoFingerY.current = null;
            gestureBusy.current = false;
            return;
          }
          if (zoomRef.current > 1.05) {
            return;
          }
          if (gestureBusy.current) {
            gestureBusy.current = false;
            endLeftDrag(lastNorm.current);
            return;
          }

          const { locationX, locationY, pageX, pageY } = e.nativeEvent;
          const n = normFromLocation(locationX, locationY);
          const duration = Date.now() - touchStart.current.t;

          if (dragging.current) {
            // If user long-pressed then released with almost no move → right click
            if (!moved.current && longFired.current) {
              client?.sendPointer('up', n.x, n.y, { button: 'left' });
              dragging.current = false;
              setDragBadge(null);
              client?.sendPointer('click', n.x, n.y, { button: 'right' });
              setDragBadge('Right-click');
              setTimeout(() => setDragBadge(null), 600);
              return;
            }
            endLeftDrag(n);
            return;
          }

          // Tap / double-tap → left click(s) only if finger barely moved
          if (!moved.current && duration < LONG_PRESS_MS + 80) {
            const now = Date.now();
            const dt = now - lastTap.current.t;
            const dist = Math.hypot(pageX - lastTap.current.x, pageY - lastTap.current.y);
            if (dt < DOUBLE_TAP_MS && dist < DOUBLE_TAP_SLOP) {
              client?.sendPointer('click', n.x, n.y, { button: 'left' });
              client?.sendPointer('click', n.x, n.y, { button: 'left' });
              lastTap.current = { t: 0, x: 0, y: 0 };
              setDragBadge('Double-click');
              setTimeout(() => setDragBadge(null), 500);
            } else {
              client?.sendPointer('click', n.x, n.y, { button: 'left' });
              lastTap.current = { t: now, x: pageX, y: pageY };
            }
          }
          // Else: pure move — cursor already placed, no click
        },
        onPanResponderTerminate: () => {
          clearLong();
          endLeftDrag(lastNorm.current);
          pinching.current = false;
          twoFingerY.current = null;
          gestureBusy.current = false;
          setDragBadge(null);
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

      {dragBadge ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{dragBadge}</Text>
        </View>
      ) : null}

      {hint && uri ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintTitle}>Touch controls</Text>
          <Text style={styles.hintLine}>Tap · left click</Text>
          <Text style={styles.hintLine}>Double-tap · double-click</Text>
          <Text style={styles.hintLine}>Long-press · right-click</Text>
          <Text style={styles.hintLine}>Long-press + drag · drag</Text>
          <Text style={styles.hintLine}>Two fingers · scroll / pinch zoom</Text>
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
  wrap: {
    flex: 1,
    backgroundColor: '#0e0e10',
    overflow: 'hidden',
  },
  stage: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    backgroundColor: '#141416',
  },
  badge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  badgeText: {
    backgroundColor: 'rgba(32,33,36,0.88)',
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
  hintTitle: {
    color: '#8ab4f8',
    fontWeight: '800',
    fontSize: 13,
    marginBottom: 6,
  },
  hintLine: {
    color: '#e8eaed',
    fontSize: 12,
    lineHeight: 18,
  },
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
  waitSoft: {
    color: '#9aa0a6',
    fontSize: 13,
    fontWeight: '600',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8ab4f8',
  },
  waitText: {
    color: '#e8eaed',
    fontSize: 14,
    fontWeight: '600',
  },
});
