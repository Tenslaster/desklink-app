import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RemoteCanvas } from '../components/RemoteCanvas';
import type { DeskLinkClient } from '../services/DeskLinkClient';
import {
  loadGestureHintSeen,
  markGestureHintSeen,
  qualityToStream,
  type QualityPreset,
} from '../services/storage';
import { colors } from '../theme/colors';

type Props = {
  client: DeskLinkClient;
  frameUri: string | null;
  screenW: number;
  screenH: number;
  latencyMs: number | null;
  status: string;
  frameCount: number;
  waitHint?: string | null;
  qualityPreset?: QualityPreset;
  onDisconnect: () => void;
  onQualityChange?: (q: QualityPreset) => void;
};

const QUALITY_OPTS: { id: QualityPreset; label: string }[] = [
  { id: 'smooth', label: 'Fluid' },
  { id: 'balanced', label: 'HD' },
  { id: 'sharp', label: 'Ultra' },
];

export function SessionScreen({
  client,
  frameUri,
  screenW,
  screenH,
  latencyMs,
  status,
  frameCount,
  waitHint,
  qualityPreset = 'balanced',
  onDisconnect,
  onQualityChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const [zoom, setZoom] = useState(1);
  const [barOpen, setBarOpen] = useState(true);
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  const [quality, setQuality] = useState<QualityPreset>(qualityPreset);
  const [showHint, setShowHint] = useState(false);

  const topPad = Math.max(insets.top, 12);
  const bottomPad = Math.max(insets.bottom, 10);

  useEffect(() => {
    loadGestureHintSeen().then((seen) => {
      if (!seen) {
        setShowHint(true);
        markGestureHintSeen();
      }
    });
  }, []);

  const zoomIn = () => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100));
  const zoomFit = () => setZoom(1);

  const applyQuality = (q: QualityPreset) => {
    setQuality(q);
    client.setQuality(qualityToStream(q));
    onQualityChange?.(q);
  };

  const sendText = () => {
    const t = text;
    if (!t.trim()) return;
    client.sendText(t);
    setText('');
  };

  const sendKey = (key: string) => {
    client.sendKey(key, true);
    setTimeout(() => client.sendKey(key, false), 40);
  };

  const live = !!frameUri;
  const latLabel =
    latencyMs == null ? null : latencyMs < 40 ? 'Excellent' : latencyMs < 80 ? 'Good' : 'Fair';

  const statusLine = [
    status,
    latencyMs != null ? `${latencyMs} ms` : null,
    latLabel,
    frameCount > 0 ? `${frameCount}f` : null,
    zoom > 1 ? `${Math.round(zoom * 100)}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.root}>
      <StatusBar hidden barStyle="light-content" />

      <View style={[styles.topBar, { paddingTop: topPad }]}>
        <View style={styles.topInner}>
          <View style={[styles.liveDot, live ? styles.liveDotOn : styles.liveDotWait]} />
          <View style={styles.topTextCol}>
            <Text style={styles.topTitle} numberOfLines={1}>
              {live ? 'DeskLink · Live' : 'Waiting for screen'}
            </Text>
            <Text style={styles.topSub} numberOfLines={1}>
              {statusLine || '…'}
            </Text>
            {!live && waitHint ? (
              <Text style={styles.topHint} numberOfLines={2}>
                {waitHint}
              </Text>
            ) : null}
          </View>
          <Pressable style={styles.discChip} onPress={onDisconnect} hitSlop={8}>
            <Text style={styles.discChipText}>Exit</Text>
          </Pressable>
        </View>

        {/* Live quality chips — switch mid-session without reconnect */}
        {live && barOpen ? (
          <View style={styles.qualityRow}>
            {QUALITY_OPTS.map((q) => {
              const on = quality === q.id;
              return (
                <Pressable
                  key={q.id}
                  onPress={() => applyQuality(q.id)}
                  style={[styles.qChip, on && styles.qChipOn]}
                >
                  <Text style={[styles.qChipText, on && styles.qChipTextOn]}>{q.label}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.qHint}>cursor on · high quality</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.canvasHost}>
        <RemoteCanvas
          uri={frameUri}
          client={client}
          screenW={screenW}
          screenH={screenH}
          zoom={zoom}
          onZoomChange={setZoom}
          compactWait
          showGestureHint={showHint && live}
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        style={[styles.bottomBar, { paddingBottom: bottomPad }]}
      >
        {barOpen && textMode ? (
          <View style={styles.textBar}>
            <TextInput
              style={styles.textInput}
              value={text}
              onChangeText={setText}
              placeholder="Type text for PC…"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="send"
              onSubmitEditing={sendText}
              blurOnSubmit={false}
            />
            <Pressable style={styles.sendBtn} onPress={sendText}>
              <Text style={styles.sendBtnText}>Send</Text>
            </Pressable>
          </View>
        ) : null}

        {barOpen && textMode ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.keysRow}
            keyboardShouldPersistTaps="handled"
          >
            {[
              { l: 'Esc', k: 'escape' },
              { l: 'Tab', k: 'tab' },
              { l: 'Ctrl', k: 'ctrl' },
              { l: 'Alt', k: 'alt' },
              { l: 'Win', k: 'win' },
              { l: 'Del', k: 'delete' },
              { l: '↵', k: 'enter' },
              { l: '⌫', k: 'backspace' },
            ].map((k) => (
              <Pressable key={k.k} style={styles.keyChip} onPress={() => sendKey(k.k)}>
                <Text style={styles.keyChipText}>{k.l}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {barOpen ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbarScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.toolbar}>
              <ToolBtn
                label="⌨"
                title="Keyboard"
                active={textMode}
                onPress={() => setTextMode((v) => !v)}
              />
              <ToolBtn label="−" title="Zoom out" onPress={zoomOut} />
              <ToolBtn label={`${Math.round(zoom * 100)}%`} title="Fit" onPress={zoomFit} wide />
              <ToolBtn label="+" title="Zoom in" onPress={zoomIn} />
              <ToolBtn label="⊡" title="Fit screen" onPress={zoomFit} />
              <View style={styles.toolbarSep} />
              <ToolBtn
                label="↑"
                title="Scroll up (mouse wheel)"
                onPress={() => client.sendPointer('scroll', -1, -1, { dy: 3 })}
              />
              <ToolBtn
                label="↓"
                title="Scroll down (mouse wheel)"
                onPress={() => client.sendPointer('scroll', -1, -1, { dy: -3 })}
              />
              <View style={styles.toolbarSep} />
              <ToolBtn label="Hide" title="Hide controls" onPress={() => setBarOpen(false)} />
              <ToolBtn label="✕" title="Disconnect" danger onPress={onDisconnect} />
            </View>
          </ScrollView>
        ) : (
          <Pressable style={styles.showBar} onPress={() => setBarOpen(true)}>
            <Text style={styles.showBarText}>Show controls</Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function ToolBtn({
  label,
  title,
  onPress,
  active,
  danger,
  wide,
}: {
  label: string;
  title: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={title}
      onPress={onPress}
      hitSlop={4}
      style={[
        styles.toolBtn,
        wide && styles.toolBtnWide,
        active && styles.toolBtnActive,
        danger && styles.toolBtnDanger,
      ]}
    >
      <Text style={[styles.toolBtnText, danger && styles.toolBtnTextDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  topInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  liveDotOn: { backgroundColor: colors.success },
  liveDotWait: { backgroundColor: colors.warning },
  topTextCol: { flex: 1, minWidth: 0 },
  topTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  topSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  topHint: { color: colors.warning, fontSize: 11, marginTop: 2 },
  discChip: {
    backgroundColor: 'rgba(242,139,130,0.18)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  discChipText: { color: colors.danger, fontWeight: '800', fontSize: 13 },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  qChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qChipOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(138,180,248,0.15)',
  },
  qChipText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  qChipTextOn: { color: colors.accent },
  qHint: { color: colors.textMuted, fontSize: 10, marginLeft: 4 },
  canvasHost: { flex: 1, minHeight: 120, backgroundColor: '#0e0e10' },
  bottomBar: {
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  textBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  textInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 },
  sendBtn: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendBtnText: { color: '#202124', fontWeight: '800', fontSize: 14 },
  keysRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  keyChip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  keyChipText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  toolbarScroll: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  toolbarSep: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 4,
  },
  toolBtn: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  toolBtnWide: { minWidth: 58 },
  toolBtnActive: { backgroundColor: 'rgba(138,180,248,0.22)' },
  toolBtnDanger: { backgroundColor: 'rgba(242,139,130,0.15)' },
  toolBtnText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  toolBtnTextDanger: { color: colors.danger },
  showBar: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  showBarText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
});
