import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RemoteCanvas } from '../components/RemoteCanvas';
import { SoftKeyboard } from '../components/SoftKeyboard';
import type { DeskLinkClient } from '../services/DeskLinkClient';
import { colors } from '../theme/colors';

type Props = {
  client: DeskLinkClient;
  frameUri: string | null;
  screenW: number;
  screenH: number;
  latencyMs: number | null;
  status: string;
  onDisconnect: () => void;
};

export function SessionScreen({
  client,
  frameUri,
  screenW,
  screenH,
  latencyMs,
  status,
  onDisconnect,
}: Props) {
  const insets = useSafeAreaInsets();
  const [kb, setKb] = useState(false);
  const [hud, setHud] = useState(true);

  return (
    <View style={styles.root}>
      <StatusBar hidden={!hud} />
      <RemoteCanvas uri={frameUri} client={client} screenW={screenW} screenH={screenH} />

      {hud ? (
        <View style={[styles.hud, { paddingTop: Math.max(8, insets.top) }]}>
          <View style={styles.hudLeft}>
            <Text style={styles.hudTitle}>DeskLink</Text>
            <Text style={styles.hudMeta}>
              {status}
              {latencyMs != null ? ` · ${latencyMs} ms` : ''}
            </Text>
          </View>
          <View style={styles.hudRight}>
            <Pressable style={styles.chip} onPress={() => setKb((v) => !v)}>
              <Text style={styles.chipText}>Keyboard</Text>
            </Pressable>
            <Pressable style={styles.chip} onPress={() => setHud(false)}>
              <Text style={styles.chipText}>Hide UI</Text>
            </Pressable>
            <Pressable style={[styles.chip, styles.chipDanger]} onPress={onDisconnect}>
              <Text style={styles.chipText}>Exit</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          style={[styles.showHud, { top: Math.max(12, insets.top) }]}
          onPress={() => setHud(true)}
        >
          <Text style={styles.showHudText}>UI</Text>
        </Pressable>
      )}

      <SoftKeyboard client={client} visible={kb} onClose={() => setKb(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  hud: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: colors.overlay,
  },
  hudLeft: { flex: 1 },
  hudTitle: { color: colors.text, fontWeight: '800', fontSize: 14 },
  hudMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  hudRight: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipDanger: { borderColor: colors.danger },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 12 },
  showHud: {
    position: 'absolute',
    right: 12,
    backgroundColor: colors.overlay,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  showHudText: { color: colors.text, fontWeight: '700', fontSize: 12 },
});
