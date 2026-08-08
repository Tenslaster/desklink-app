import React, { useCallback, useMemo, useRef } from 'react';
import {
  Image,
  LayoutChangeEvent,
  StyleSheet,
  View,
  GestureResponderEvent,
  PanResponder,
} from 'react-native';
import type { DeskLinkClient } from '../services/DeskLinkClient';
import { colors } from '../theme/colors';

type Props = {
  uri: string | null;
  client: DeskLinkClient | null;
  /** Host desktop aspect (width/height) for letterboxing */
  screenW: number;
  screenH: number;
};

/**
 * Maps touch coordinates from the letterboxed image rect into normalized 0–1 desktop coords.
 */
export function RemoteCanvas({ uri, client, screenW, screenH }: Props) {
  const layout = useRef({ w: 1, h: 1 });
  const content = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const lastNorm = useRef({ x: 0.5, y: 0.5 });
  const scrolling = useRef(false);
  const twoFingerY = useRef<number | null>(null);

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
      w: cw,
      h: ch,
    };
  }, [aspect]);

  const onLayout = (e: LayoutChangeEvent) => {
    layout.current = {
      w: e.nativeEvent.layout.width,
      h: e.nativeEvent.layout.height,
    };
    recomputeContent();
  };

  const toNorm = (pageX: number, pageY: number, target: View | null) => {
    // We use locationX/Y relative to this view when available
    return { x: 0, y: 0 };
  };

  const normFromLocation = (lx: number, ly: number) => {
    const c = content.current;
    const x = (lx - c.x) / c.w;
    const y = (ly - c.y) / c.h;
    const nx = Math.max(0, Math.min(1, x));
    const ny = Math.max(0, Math.min(1, y));
    lastNorm.current = { x: nx, y: ny };
    return lastNorm.current;
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            scrolling.current = true;
            twoFingerY.current = touches[0].pageY;
            return;
          }
          scrolling.current = false;
          const { locationX, locationY } = e.nativeEvent;
          const n = normFromLocation(locationX, locationY);
          client?.sendPointer('down', n.x, n.y, { button: 'left' });
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;
          if (scrolling.current || touches.length >= 2) {
            const y = touches[0]?.pageY ?? e.nativeEvent.pageY;
            if (twoFingerY.current != null) {
              const dy = twoFingerY.current - y;
              if (Math.abs(dy) > 8) {
                const steps = Math.max(-3, Math.min(3, Math.round(dy / 24)));
                if (steps !== 0) {
                  const n = lastNorm.current;
                  client?.sendPointer('scroll', n.x, n.y, { dy: steps });
                  twoFingerY.current = y;
                }
              }
            } else {
              twoFingerY.current = y;
            }
            return;
          }
          const { locationX, locationY } = e.nativeEvent;
          const n = normFromLocation(locationX, locationY);
          client?.sendPointer('move', n.x, n.y);
        },
        onPanResponderRelease: (e: GestureResponderEvent) => {
          if (scrolling.current) {
            scrolling.current = false;
            twoFingerY.current = null;
            return;
          }
          const { locationX, locationY } = e.nativeEvent;
          const n = normFromLocation(locationX, locationY);
          client?.sendPointer('up', n.x, n.y, { button: 'left' });
        },
        onPanResponderTerminate: () => {
          const n = lastNorm.current;
          client?.sendPointer('up', n.x, n.y, { button: 'left' });
          scrolling.current = false;
          twoFingerY.current = null;
        },
      }),
    [client],
  );

  // silence unused
  void toNorm;

  return (
    <View style={styles.wrap} onLayout={onLayout} {...pan.panHandlers}>
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.image}
          resizeMode="contain"
          // Prefer lower memory churn
          fadeDuration={0}
        />
      ) : (
        <View style={styles.placeholder} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    backgroundColor: colors.surface,
  },
});
