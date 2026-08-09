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
  /** Fired when connected but no frame arrived for too long */
  onFrameTimeout?: (seconds: number) => void;
};

export class DeskLinkClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private token: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private frameWatchTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  /** Coalesce frames to one paint per animation frame */
  private pendingUri: string | null = null;
  private pendingBytes = 0;
  private rafScheduled = false;
  private frames = 0;
  private password = '';
  private connectedAt = 0;
  private lastFrameAt = 0;
  private authSent = false;

  constructor(private readonly events: ClientEvents) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  get frameCount(): number {
    return this.frames;
  }

  get msSinceLastFrame(): number {
    if (!this.lastFrameAt) return this.connectedAt ? Date.now() - this.connectedAt : 0;
    return Date.now() - this.lastFrameAt;
  }

  connect(host: string, port: number, password: string): void {
    this.disconnect();
    this.disposed = false;
    this.frames = 0;
    this.password = password;
    this.authSent = false;
    this.lastFrameAt = 0;
    this.connectedAt = 0;
    this.pendingUri = null;
    this.rafScheduled = false;

    const cleanHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const url = `ws://${cleanHost}:${port}`;
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
      // JSON frames only — binary DLK1 is unreliable on React Native WebSocket
      this.sendPreferJson();
      this.sendAuthOnce();
    };

    ws.onmessage = (ev) => {
      if (this.disposed) return;
      void this.onMessage(ev.data);
    };

    ws.onerror = () => {
      if (this.disposed) return;
      this.setState('error', 'Connection error — check IP, port, Wi‑Fi, and firewall');
    };

    ws.onclose = (ev) => {
      this.stopPing();
      this.stopFrameWatch();
      if (this.disposed) return;
      if (this.state !== 'error') {
        const reason = ev.reason || (ev.code ? `code ${ev.code}` : 'Disconnected');
        this.setState('closed', reason);
      }
      this.ws = null;
    };
  }

  private sendPreferJson(): void {
    this.send({ type: 'prefer', format: 'json', binary: false });
  }

  private sendAuthOnce(): void {
    if (this.authSent) return;
    this.authSent = true;
    this.send({ type: 'auth', password: this.password });
  }

  private async onMessage(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      const msg = decodeMsg(data);
      if (!msg) return;
      this.handleJson(msg);
      return;
    }

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
      // Host sends hello first; auth if we haven't yet (or reconnect path)
      if (this.state === 'authenticating' || this.state === 'connecting') {
        this.sendPreferJson();
        // Allow re-auth on hello if previous auth was before hello arrived without response
        if (!this.token) {
          this.authSent = false;
          this.sendAuthOnce();
        }
      }
      return;
    }

    if (msg.type === 'auth_ok') {
      const m = msg as { token?: string; screen?: { width: number; height: number } };
      this.token = m.token || null;
      if (m.screen) this.events.onScreen(m.screen.width, m.screen.height);
      this.connectedAt = Date.now();
      this.lastFrameAt = 0;
      this.setState('streaming');
      this.startPing();
      this.startFrameWatch();
      // Ensure JSON path + ask host for an immediate keyframe
      this.sendPreferJson();
      this.send({ type: 'keyframe' });
      return;
    }

    if (msg.type === 'frame') {
      const data = (msg as { data?: string }).data;
      if (typeof data === 'string' && data.length > 0) {
        // Avoid double "data:image..." prefix if host ever sends full URI
        const uri = data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}`;
        this.emitUri(uri, data.length);
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
    this.lastFrameAt = Date.now();
    this.events.onFrameCount?.(this.frames);
    // Keep latest frame only — drop intermediate ones under load
    this.pendingUri = uri;
    this.pendingBytes = bytes;
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    const flush = () => {
      this.rafScheduled = false;
      if (this.disposed || !this.pendingUri) return;
      const next = this.pendingUri;
      const b = this.pendingBytes;
      this.pendingUri = null;
      this.pendingBytes = 0;
      this.events.onFrame(next, b);
    };
    // requestAnimationFrame is not always available in RN; setTimeout(0) is fine
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 0);
    }
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
    // New quality → force a keyframe so UI updates immediately
    this.send({ type: 'keyframe' });
  }

  requestKeyframe(): void {
    if (this.state !== 'streaming') return;
    this.send({ type: 'keyframe' });
  }

  disconnect(): void {
    this.disposed = true;
    this.stopPing();
    this.stopFrameWatch();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.token = null;
    this.authSent = false;
    this.pendingUri = null;
    this.rafScheduled = false;
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
    }, 4000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private startFrameWatch(): void {
    this.stopFrameWatch();
    let lastAlert = 0;
    this.frameWatchTimer = setInterval(() => {
      if (this.state !== 'streaming' || this.frames > 0) {
        if (this.frames > 0) {
          // Still request keyframe if stream stalls after first frame
          if (this.msSinceLastFrame > 4000) {
            this.send({ type: 'keyframe' });
          }
        }
        return;
      }
      const waited = Math.round((Date.now() - this.connectedAt) / 1000);
      // Keep asking for a keyframe every 2s until first frame
      this.send({ type: 'keyframe' });
      if (waited >= 3 && waited - lastAlert >= 3) {
        lastAlert = waited;
        this.events.onFrameTimeout?.(waited);
      }
    }, 2000);
  }

  private stopFrameWatch(): void {
    if (this.frameWatchTimer) {
      clearInterval(this.frameWatchTimer);
      this.frameWatchTimer = null;
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
