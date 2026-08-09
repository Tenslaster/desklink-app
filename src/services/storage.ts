import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  host: 'desklink_host',
  port: 'desklink_port',
  password: 'desklink_password',
  remember: 'desklink_remember',
  qualityPreset: 'desklink_quality',
  gestureHintSeen: 'desklink_gesture_hint',
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

export async function loadGestureHintSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEYS.gestureHintSeen)) === '1';
  } catch {
    return false;
  }
}

export async function markGestureHintSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.gestureHintSeen, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Quality-first presets (readable desktop text on iPhone).
 * DXGI captures on GPU; encode uses high JPEG + near-native scale.
 */
export function qualityToStream(preset: QualityPreset): {
  fps: number;
  scale: number;
  jpeg_quality: number;
} {
  switch (preset) {
    case 'smooth':
      // Still sharp enough — not the old blurry 0.5 scale
      return { fps: 28, scale: 0.78, jpeg_quality: 76 };
    case 'sharp':
      // Native-ish resolution, max clarity
      return { fps: 20, scale: 1.0, jpeg_quality: 88 };
    case 'balanced':
    default:
      // Default: clear text, solid motion
      return { fps: 24, scale: 0.92, jpeg_quality: 84 };
  }
}
