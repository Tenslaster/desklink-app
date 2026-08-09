import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RemoteCanvas } from '../components/RemoteCanvas';
import type { DeskLinkClient } from '../services/DeskLinkClient';

/**
 * Chrome Remote Desktop–style session UI:
 * full-bleed desktop + bottom control bar + text send field + zoom.
 */
type Props = {
  client: DeskLinkClient;
  frameUri: string | null;
  screenW: number;
  screenH: number;
  latencyMs: number | null;
  status: string;
  frameCount: number;
  onDisconnect: () => void;
};

export function SessionScreen({
  client,
  frameUri,
  screenW,
  screenH,
  latencyMs,
  status,
  frameCount,
  onDisconnect,
}: Props) {
  const insets = useSafeAreaInsets();
  const [zoom, setZoom] = useState(1);
  const [barOpen, setBarOpen] = useState(true);
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');

  const zoomIn = () => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100));
  const zoomFit = () => {
    setZoom(1);
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

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <RemoteCanvas
        uri={frameUri}
        client={client}
        screenW={screenW}
        screenH={screenH}
        zoom={zoom}
        onZoomChange={setZoom}
      />

      {/* Top status strip (like CRD connection chip) */}
      {barOpen ? (
        <View style={[styles.topChipWrap, { top: Math.max(8, insets.top) }]} pointerEvents="box-none">
          <View style={styles.topChip}>
            <View style={[styles.liveDot, !frameUri && styles.liveDotWait]} />
            <Text style={styles.topChipText} numberOfLines={1}>
              {status}
              {latencyMs != null ? ` · ${latencyMs} ms` : ''}
              {frameCount > 0 ? ` · ${frameCount}f` : ''}
              {zoom > 1 ? ` · ${Math.round(zoom * 100)}%` : ''}
            </Text>
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        style={styles.bottomHost}
        pointerEvents="box-none"
      >
        {/* Text bar — type then Send (Chrome RD keyboard panel feel) */}
        {barOpen && textMode ? (
          <View style={[styles.textBar, { marginBottom: 8 }]}>
            <TextInput
              style={styles.textInput}
              value={text}
              onChangeText={setText}
              placeholder="Type text to send to PC…"
              placeholderTextColor="#9aa0a6"
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

        {/* Quick keys row when text mode open */}
        {barOpen && textMode ? (
          <View style={styles.keysRow}>
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
          </View>
        ) : null}

        {/* Main control bar — CRD style pill */}
        {barOpen ? (
          <View style={[styles.toolbar, { marginBottom: Math.max(10, insets.bottom) }]}>
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
            <ToolBtn label="✕" title="Disconnect" danger onPress={onDisconnect} />
          </View>
        ) : (
          <Pressable
            style={[styles.showBar, { marginBottom: Math.max(12, insets.bottom) }]}
            onPress={() => setBarOpen(true)}
          >
            <Text style={styles.showBarText}>Controls</Text>
          </Pressable>
        )}

        {barOpen ? (
          <Pressable style={styles.hideHint} onPress={() => setBarOpen(false)}>
            <Text style={styles.hideHintText}>Hide controls</Text>
          </Pressable>
        ) : null}
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
  root: { flex: 1, backgroundColor: '#202124' },
  topChipWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  topChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(32,33,36,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    maxWidth: '92%',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#81c995',
  },
  liveDotWait: {
    backgroundColor: '#fdd663',
  },
  topChipText: {
    color: '#e8eaed',
    fontSize: 12,
    fontWeight: '600',
  },
  bottomHost: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  textBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 720,
    backgroundColor: 'rgba(32,33,36,0.96)',
    borderRadius: 28,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  textInput: {
    flex: 1,
    color: '#e8eaed',
    fontSize: 16,
    paddingVertical: 10,
  },
  sendBtn: {
    backgroundColor: '#8ab4f8',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnText: {
    color: '#202124',
    fontWeight: '800',
    fontSize: 14,
  },
  keysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
    maxWidth: 720,
  },
  keyChip: {
    backgroundColor: 'rgba(60,64,67,0.95)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  keyChipText: {
    color: '#e8eaed',
    fontWeight: '700',
    fontSize: 12,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(32,33,36,0.96)',
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    maxWidth: '100%',
  },
  toolbarSep: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 4,
  },
  toolBtn: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  toolBtnWide: {
    minWidth: 56,
  },
  toolBtnActive: {
    backgroundColor: 'rgba(138,180,248,0.22)',
  },
  toolBtnDanger: {
    backgroundColor: 'rgba(242,139,130,0.15)',
  },
  toolBtnText: {
    color: '#e8eaed',
    fontSize: 16,
    fontWeight: '700',
  },
  toolBtnTextDanger: {
    color: '#f28b82',
  },
  showBar: {
    backgroundColor: 'rgba(32,33,36,0.92)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  showBarText: {
    color: '#8ab4f8',
    fontWeight: '700',
    fontSize: 13,
  },
  hideHint: {
    marginTop: 4,
    marginBottom: 2,
    padding: 4,
  },
  hideHintText: {
    color: '#9aa0a6',
    fontSize: 11,
  },
});
