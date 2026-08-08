import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import type { DeskLinkClient } from '../services/DeskLinkClient';
import { colors } from '../theme/colors';

const SPECIALS: { label: string; key: string }[] = [
  { label: 'Esc', key: 'escape' },
  { label: 'Tab', key: 'tab' },
  { label: 'Ctrl', key: 'ctrl' },
  { label: 'Alt', key: 'alt' },
  { label: 'Win', key: 'win' },
  { label: 'Del', key: 'delete' },
  { label: '↑', key: 'up' },
  { label: '↓', key: 'down' },
  { label: '←', key: 'left' },
  { label: '→', key: 'right' },
  { label: 'Enter', key: 'enter' },
  { label: 'Bksp', key: 'backspace' },
];

type Props = {
  client: DeskLinkClient | null;
  visible: boolean;
  onClose: () => void;
};

export function SoftKeyboard({ client, visible, onClose }: Props) {
  const [text, setText] = useState('');

  if (!visible) return null;

  const sendSpecial = (key: string) => {
    client?.sendKey(key, true);
    setTimeout(() => client?.sendKey(key, false), 40);
  };

  const flushText = () => {
    if (!text) return;
    client?.sendText(text);
    setText('');
  };

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={styles.title}>Keyboard</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Type then Send…"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        onSubmitEditing={flushText}
        returnKeyType="send"
      />
      <Pressable style={styles.sendBtn} onPress={flushText}>
        <Text style={styles.sendText}>Send text</Text>
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys}>
        {SPECIALS.map((s) => (
          <Pressable key={s.key + s.label} style={styles.key} onPress={() => sendSpecial(s.key)}>
            <Text style={styles.keyText}>{s.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 12,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { color: colors.text, fontWeight: '600', fontSize: 15 },
  close: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sendText: { color: '#fff', fontWeight: '700' },
  keys: { gap: 8, paddingVertical: 4 },
  key: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyText: { color: colors.text, fontWeight: '600', fontSize: 13 },
});
