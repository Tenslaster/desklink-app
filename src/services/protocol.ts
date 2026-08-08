/** DeskLink wire protocol (must match host). */

export const FRAME_MAGIC = 'DLK1';
export const DEFAULT_PORT = 9478;

export type HelloMsg = {
  type: 'hello';
  version: string;
  protocol: number;
  screen: { width: number; height: number };
  auth_required: boolean;
  defaults: { fps: number; scale: number; jpeg_quality: number };
};

export type AuthOkMsg = {
  type: 'auth_ok';
  token: string;
  screen?: { width: number; height: number };
  stream?: { fps: number; scale: number; jpeg_quality: number };
};

export type AuthFailMsg = {
  type: 'auth_fail';
  code: string;
  message: string;
};

export type ErrorMsg = {
  type: 'error';
  code: string;
  message: string;
};

export type PongMsg = {
  type: 'pong';
  t?: number;
  server_t?: number;
};

export type QualityOkMsg = {
  type: 'quality_ok';
  stream: { fps: number; scale: number; jpeg_quality: number };
};

export type ServerMsg =
  | HelloMsg
  | AuthOkMsg
  | AuthFailMsg
  | ErrorMsg
  | PongMsg
  | QualityOkMsg
  | { type: string; [k: string]: unknown };

export function encodeMsg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

export function decodeMsg(raw: string): ServerMsg | null {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
      return null;
    }
    return data as ServerMsg;
  } catch {
    return null;
  }
}

/** Extract JPEG payload from binary DLK1 frame. */
export function unpackFrame(data: ArrayBuffer): Uint8Array | null {
  if (data.byteLength < 8) return null;
  const view = new Uint8Array(data);
  if (
    view[0] !== 0x44 || // D
    view[1] !== 0x4c || // L
    view[2] !== 0x4b || // K
    view[3] !== 0x31 // 1
  ) {
    return null;
  }
  return view.subarray(8);
}

/** Convert binary JPEG to a data URI for React Native Image. */
export function jpegToDataUri(jpeg: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < jpeg.length; i += chunk) {
    const sub = jpeg.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(sub) as number[]);
  }
  // base64
  const b64 = globalThis.btoa(binary);
  return `data:image/jpeg;base64,${b64}`;
}

/**
 * Faster path when Buffer polyfill exists; falls back to pure JS.
 * React Native / Hermes typically has no btoa for large arrays well — use chunked.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    const chunk = 0x2000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, i + chunk);
      // apply avoids spread stack limits on large frames
      binary += String.fromCharCode.apply(null, sub as unknown as number[]);
    }
    return globalThis.btoa(binary);
  }
  // Manual base64
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      chars[(n >> 18) & 63] +
      chars[(n >> 12) & 63] +
      chars[(n >> 6) & 63] +
      chars[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + '=';
  }
  return out;
}

export function jpegBytesToUri(jpeg: Uint8Array): string {
  return `data:image/jpeg;base64,${uint8ToBase64(jpeg)}`;
}
