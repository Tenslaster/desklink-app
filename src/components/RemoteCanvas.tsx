import React, { useCallback, useMemo, useRef } from 'react';
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
import { colors } from '../theme/colors';

type Props = {
  uri: string | null;
  client: DeskLinkClient | null;
  screenW: number;
  screenH: number;
  /** 1 = fit, >1 zoomed */
  zoom: number;
  onZoomChange?: (z: number) => void;
};

/**
 * Remote desktop surface with letterbox fit + pinch/zoom pan.
 * Touch → host mouse (normalized 0–1 over the visible desktop).
 */
export function RemoteCanvas({ uri, client, screenW, screenH, zoom, onZoomChange }: Props) {
  const layout = useRef({ w: 1, h: 1 });
  const content = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const lastNorm = useRef({ x: 0.5, y: 0.5 });
  const scrolling = useRef(false);
  const pinching = useRef(false);
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const twoFingerY = useRef<number | null>(null);
  const panOffset = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const animPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

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
    // Undo pan + zoom around center of content rect
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

  const touchDist = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    if (t.length < 2) return 0;
    const dx = t[0].pageX - t[1].pageX;
    const dy = t[0].pageY - t[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            pinching.current = true;
            scrolling.current = false;
            pinchStartDist.current = touchDist(e) || 1;
            pinchStartZoom.current = zoomRef.current;
            twoFingerY.current = (touches[0].pageY + touches[1].pageY) / 2;
            return;
          }
          pinching.current = false;
          scrolling.current = false;
          panStart.current = { ...panOffset.current };
          const { locationX, locationY } = e.nativeEvent;
          const n = normFromLocation(locationX, locationY);
          if (zoomRef.current <= 1.05) {
            client?.sendPointer('down', n.x, n.y, { button: 'left' });
          }
        },
        onPanResponderMove: (e: GestureResponderEvent, g) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2 || pinching.current) {
            const d = touchDist(e);
            if (d > 0 && pinchStartDist.current > 0) {
              const ratio = d / pinchStartDist.current;
              const next = Math.max(1, Math.min(4, pinchStartZoom.current * ratio));
              onZoomChange?.(Math.round(next * 20) / 20);
            }
            // two-finger scroll when zoom ~1
            if (zoomRef.current <= 1.05) {
              const midY = (touches[0].pageY + (touches[1]?.pageY ?? touches[0].pageY)) / 2;
              if (twoFingerY.current != null) {
                const dy = twoFingerY.current - midY;
                if (Math.abs(dy) > 12) {
                  const steps = Math.max(-3, Math.min(3, Math.round(dy / 28)));
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
            // pan zoomed desktop
            panOffset.current = {
              x: panStart.current.x + g.dx,
              y: panStart.current.y + g.dy,
            };
            animPan.setValue(panOffset.current);
            return;
          }

          const { locationX, locationY } = e.nativeEvent;
          const n = normFromLocation(locationX, locationY);
          client?.sendPointer('move', n.x, n.y);
        },
        onPanResponderRelease: (e: GestureResponderEvent) => {
          if (pinching.current) {
            pinching.current = false;
            twoFingerY.current = null;
            return;
          }
          if (zoomRef.current > 1.05) {
            return;
          }
          const { locationX, locationY } = e.nativeEvent;
          const n = normFromLocation(locationX, locationY);
          client?.sendPointer('up', n.x, n.y, { button: 'left' });
        },
        onPanResponderTerminate: () => {
          const n = lastNorm.current;
          if (zoomRef.current <= 1.05) {
            client?.sendPointer('up', n.x, n.y, { button: 'left' });
          }
          pinching.current = false;
          scrolling.current = false;
          twoFingerY.current = null;
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
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            fadeDuration={0}
          />
        ) : (
          <View style={styles.placeholder} />
        )}
      </Animated.View>
      {!uri ? (
        <View style={styles.waitOverlay} pointerEvents="none">
          <View style={styles.waitPill}>
            <View style={styles.dot} />
            <Text style={styles.waitText}>Waiting for screen…</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#111',
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
    backgroundColor: '#1a1a1a',
  },
  waitOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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
