import {
  decodeMsg,
  encodeMsg,
  jpegBytesToUri,
  unpackFrame,
  type ServerMsg,
} from './protocol';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'streaming'
  | 'error'
  | 'closed';

export type ClientEvents = {
  onState: (state: ConnectionState, detail?: string) => void;
  onFrame: (dataUri: string, bytes: number) => void;
  onScreen: (width: number, height: number) => void;
  onLatency: (ms: number) => void;
  onMessage: (msg: ServerMsg) => void;
  onFrameCount?: (n: number) => void;
};

export class DeskLinkClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private token: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private frameBusy = false;
  private pendingUri: string | null = null;
  private frames = 0;
  private password = '';

  constructor(private readonly events: ClientEvents) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  get frameCount(): number {
    return this.frames;
  }

  connect(host: string, port: number, password: string): void {
    this.disconnect();
    this.disposed = false;
    this.frames = 0;
    this.password = password;
    const url = `ws://${host.trim()}:${port}`;
    this.setState('connecting', url);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.setState('error', e instanceof Error ? e.message : 'Failed to open socket');
      return;
    }
    this.ws = ws;
    try {
      ws.binaryType = 'arraybuffer';
    } catch {
      /* ignore */
    }

    ws.onopen = () => {
      if (this.disposed) return;
      this.setState('authenticating');
      // Prefer JSON base64 frames (reliable on React Native)
      this.send({ type: 'prefer', format: 'json', binary: false });
      this.send({ type: 'auth', password: this.password });
    };

    ws.onmessage = (ev) => {
      if (this.disposed) return;
      void this.onMessage(ev.data);
    };

    ws.onerror = () => {
      if (this.disposed) return;
      this.setState('error', 'Connection error — check IP, port, Wi‑Fi, and firewall');
    };

    ws.onclose = () => {
      this.stopPing();
      if (this.disposed) return;
      if (this.state !== 'error') {
        this.setState('closed', 'Disconnected');
      }
      this.ws = null;
    };
  }

  private async onMessage(data: unknown): Promise<void> {
    // Text / JSON control + frame messages
    if (typeof data === 'string') {
      const msg = decodeMsg(data);
      if (!msg) return;
      this.handleJson(msg);
      return;
    }

    // Binary DLK1 or raw JPEG
    try {
      let ab: ArrayBuffer | null = null;
      if (data instanceof ArrayBuffer) {
        ab = data;
      } else if (ArrayBuffer.isView(data)) {
        const v = data as ArrayBufferView;
        ab = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
      } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
        ab = await data.arrayBuffer();
      }
      if (!ab) return;
      const jpeg = unpackFrame(ab);
      if (!jpeg) return;
      this.emitJpeg(jpeg);
    } catch {
      /* ignore bad binary */
    }
  }

  private handleJson(msg: ServerMsg): void {
    this.events.onMessage(msg);

    if (msg.type === 'hello') {
      const h = msg as { screen?: { width: number; height: number } };
      if (h.screen) this.events.onScreen(h.screen.width, h.screen.height);
      if (this.state === 'authenticating' || this.state === 'connecting') {
        this.send({ type: 'prefer', format: 'json', binary: false });
        this.send({ type: 'auth', password: this.password });
      }
      return;
    }

    if (msg.type === 'auth_ok') {
      const m = msg as { token?: string; screen?: { width: number; height: number } };
      this.token = m.token || null;
      if (m.screen) this.events.onScreen(m.screen.width, m.screen.height);
      this.setState('streaming');
      this.startPing();
      // Re-assert JSON frames after auth (stream starts on host after auth_ok)
      this.send({ type: 'prefer', format: 'json', binary: false });
      return;
    }

    if (msg.type === 'frame') {
      const data = (msg as { data?: string }).data;
      if (typeof data === 'string' && data.length > 0) {
        this.emitUri(`data:image/jpeg;base64,${data}`, data.length);
      }
      return;
    }

    if (msg.type === 'auth_fail') {
      const m = msg as { message?: string };
      this.setState('error', m.message || 'Authentication failed');
      this.ws?.close();
      return;
    }

    if (msg.type === 'error') {
      const m = msg as { message?: string };
      this.setState('error', m.message || 'Server error');
      return;
    }

    if (msg.type === 'pong') {
      const m = msg as { t?: number };
      if (typeof m.t === 'number') {
        this.events.onLatency(Math.max(0, Date.now() - m.t));
      }
      return;
    }
  }

  private emitJpeg(jpeg: Uint8Array): void {
    try {
      this.emitUri(jpegBytesToUri(jpeg), jpeg.byteLength);
    } catch {
      /* ignore encode errors */
    }
  }

  private emitUri(uri: string, bytes: number): void {
    this.frames += 1;
    this.events.onFrameCount?.(this.frames);
    if (this.frameBusy) {
      this.pendingUri = uri;
      return;
    }
    this.frameBusy = true;
    this.events.onFrame(uri, bytes);
    // Release after paint
    setTimeout(() => {
      this.frameBusy = false;
      if (this.pendingUri) {
        const next = this.pendingUri;
        this.pendingUri = null;
        this.emitUri(next, 0);
      }
    }, 16);
  }

  sendPointer(
    action: 'move' | 'down' | 'up' | 'click' | 'scroll',
    x: number,
    y: number,
    extra?: { button?: string; dx?: number; dy?: number },
  ): void {
    if (this.state !== 'streaming') return;
    this.send({
      type: 'pointer',
      action,
      x: clamp01(x),
      y: clamp01(y),
      button: extra?.button || 'left',
      dx: extra?.dx || 0,
      dy: extra?.dy || 0,
    });
  }

  sendKey(key: string, pressed: boolean): void {
    if (this.state !== 'streaming') return;
    this.send({ type: 'key', key, pressed });
  }

  sendText(text: string): void {
    if (this.state !== 'streaming' || !text) return;
    this.send({ type: 'text', text: text.slice(0, 512) });
  }

  setQuality(opts: { fps: number; scale: number; jpeg_quality: number }): void {
    if (this.state !== 'streaming') return;
    this.send({ type: 'quality', ...opts });
  }

  disconnect(): void {
    this.disposed = true;
    this.stopPing();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.token = null;
    this.setState('idle');
  }

  private send(obj: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(encodeMsg(obj));
    } catch {
      /* ignore */
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping', t: Date.now() });
    }, 3000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.state = state;
    this.events.onState(state, detail);
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
