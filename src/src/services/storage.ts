import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  host: 'desklink_host',
  port: 'desklink_port',
  password: 'desklink_password',
  remember: 'desklink_remember',
  qualityPreset: 'desklink_quality',
} as const;

export type QualityPreset = 'smooth' | 'balanced' | 'sharp';

export type SavedConnection = {
  host: string;
  port: string;
  password: string;
  remember: boolean;
  qualityPreset: QualityPreset;
};

const DEFAULTS: SavedConnection = {
  host: '',
  port: '9478',
  password: '',
  remember: true,
  qualityPreset: 'balanced',
};

export async function loadConnection(): Promise<SavedConnection> {
  try {
    const [host, port, remember, qualityPreset] = await Promise.all([
      AsyncStorage.getItem(KEYS.host),
      AsyncStorage.getItem(KEYS.port),
      AsyncStorage.getItem(KEYS.remember),
      AsyncStorage.getItem(KEYS.qualityPreset),
    ]);
    let password = '';
    try {
      password = (await SecureStore.getItemAsync(KEYS.password)) || '';
    } catch {
      password = '';
    }
    return {
      host: host || DEFAULTS.host,
      port: port || DEFAULTS.port,
      password,
      remember: remember !== '0',
      qualityPreset: (qualityPreset as QualityPreset) || DEFAULTS.qualityPreset,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConnection(conn: SavedConnection): Promise<void> {
  await AsyncStorage.setItem(KEYS.host, conn.host.trim());
  await AsyncStorage.setItem(KEYS.port, conn.port.trim() || '9478');
  await AsyncStorage.setItem(KEYS.remember, conn.remember ? '1' : '0');
  await AsyncStorage.setItem(KEYS.qualityPreset, conn.qualityPreset);
  if (conn.remember && conn.password) {
    await SecureStore.setItemAsync(KEYS.password, conn.password);
  } else {
    try {
      await SecureStore.deleteItemAsync(KEYS.password);
    } catch {
      /* ignore */
    }
  }
}

export function qualityToStream(preset: QualityPreset): {
  fps: number;
  scale: number;
  jpeg_quality: number;
} {
  switch (preset) {
    case 'smooth':
      return { fps: 22, scale: 0.35, jpeg_quality: 40 };
    case 'sharp':
      return { fps: 12, scale: 0.65, jpeg_quality: 70 };
    case 'balanced':
    default:
      return { fps: 16, scale: 0.45, jpeg_quality: 55 };
  }
}
