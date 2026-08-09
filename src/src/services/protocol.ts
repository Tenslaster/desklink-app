/** DeskLink wire protocol (must match host). */

export const DEFAULT_PORT = 9478;

export type ServerMsg =
  | { type: 'hello'; version?: string; screen?: { width: number; height: number }; [k: string]: unknown }
  | { type: 'auth_ok'; token?: string; screen?: { width: number; height: number }; [k: string]: unknown }
  | { type: 'auth_fail'; code?: string; message?: string }
  | { type: 'error'; code?: string; message?: string }
  | { type: 'pong'; t?: number; server_t?: number }
  | { type: 'frame'; mime?: string; data: string }
  | { type: 'quality_ok'; stream?: { fps: number; scale: number; jpeg_quality: number } }
  | { type: 'prefer_ok'; binary?: boolean }
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
export function unpackFrame(data: ArrayBuffer | ArrayBufferView): Uint8Array | null {
  const view =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (view.byteLength < 8) return null;
  if (view[0] !== 0x44 || view[1] !== 0x4c || view[2] !== 0x4b || view[3] !== 0x31) {
    // Maybe raw JPEG (FF D8)
    if (view[0] === 0xff && view[1] === 0xd8) return view;
    return null;
  }
  return view.subarray(8);
}

/** Pure JS base64 — Hermes-safe (no btoa / TypedArray.apply). */
export function uint8ToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      chars[(n >> 18) & 63] +
      chars[(n >> 12) & 63] +
      chars[(n >> 6) & 63] +
      chars[n & 63];
  }
  const rem = len - i;
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
