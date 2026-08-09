import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Switch,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import {
  loadConnection,
  saveConnection,
  type QualityPreset,
  type SavedConnection,
} from '../services/storage';
import { DEFAULT_PORT } from '../services/protocol';

type Props = {
  onConnect: (host: string, port: number, password: string, quality: QualityPreset) => void;
  busy?: boolean;
  error?: string | null;
};

const PRESETS: { id: QualityPreset; label: string; hint: string }[] = [
  { id: 'smooth', label: 'Fluid', hint: '28 fps · clear' },
  { id: 'balanced', label: 'HD', hint: '24 fps · recommended' },
  { id: 'sharp', label: 'Ultra', hint: 'Native · max detail' },
];

export function ConnectScreen({ onConnect, busy, error }: Props) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [quality, setQuality] = useState<QualityPreset>('balanced');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadConnection().then((c: SavedConnection) => {
      setHost(c.host);
      setPort(c.port);
      setPassword(c.password);
      setRemember(c.remember);
      setQuality(c.qualityPreset);
      setLoaded(true);
    });
  }, []);

  const submit = async () => {
    const h = host.trim();
    const p = parseInt(port.trim() || String(DEFAULT_PORT), 10);
    if (!h || !password || Number.isNaN(p) || p < 1 || p > 65535) return;
    await saveConnection({
      host: h,
      port: String(p),
      password,
      remember,
      qualityPreset: quality,
    });
    onConnect(h, p, password, quality);
  };

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>DeskLink</Text>
          <Text style={styles.sub}>Remote control your PC · Sideload-ready</Text>

          <Text style={styles.label}>PC address (LAN IP)</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="192.168.1.42"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
          />

          <Text style={styles.label}>Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder={String(DEFAULT_PORT)}
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Host password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.row}>
            <Text style={styles.remember}>Remember password (Secure Store)</Text>
            <Switch
              value={remember}
              onValueChange={setRemember}
              trackColor={{ true: colors.accentDim, false: colors.border }}
              thumbColor={remember ? colors.accent : '#ccc'}
            />
          </View>

          <Text style={[styles.label, { marginTop: 8 }]}>Stream quality</Text>
          <View style={styles.presets}>
            {PRESETS.map((p) => {
              const on = quality === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setQuality(p.id)}
                  style={[styles.preset, on && styles.presetOn]}
                >
                  <Text style={[styles.presetLabel, on && styles.presetLabelOn]}>{p.label}</Text>
                  <Text style={styles.presetHint}>{p.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.btn, busy && styles.btnDisabled]}
            onPress={submit}
            disabled={!!busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Connect</Text>
            )}
          </Pressable>

          <Text style={styles.help}>
            1. Run start_host.bat on your PC{'\n'}
            2. Use the same Wi‑Fi as the PC{'\n'}
            3. Enter the IP printed by the host{'\n'}
            4. Allow Windows Firewall for port {DEFAULT_PORT}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 24, paddingBottom: 48 },
  logo: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 12,
  },
  sub: { color: colors.textMuted, marginBottom: 28, marginTop: 4, fontSize: 14 },
  label: { color: colors.textMuted, marginBottom: 6, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  remember: { color: colors.text, flex: 1, paddingRight: 12, fontSize: 14 },
  presets: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  preset: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  presetOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  presetLabel: { color: colors.text, fontWeight: '700', fontSize: 13 },
  presetLabelOn: { color: colors.accent },
  presetHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  error: { color: colors.danger, marginBottom: 12, fontSize: 14 },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  help: {
    color: colors.textMuted,
    marginTop: 24,
    lineHeight: 22,
    fontSize: 13,
  },
});
