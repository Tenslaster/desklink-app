import {
  decodeMsg,
  encodeMsg,
  extractFrameBase64,
  frameDataToUri,
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
  onFrameTimeout?: (seconds: number) => void;
};

/** High rate so trackpad drag feels 1:1 with finger */
const MOVE_HZ = 160;
const MOVE_MIN_MS = 1000 / MOVE_HZ;

export class DeskLinkClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private token: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private frameWatchTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private pendingUri: string | null = null;
  private pendingBytes = 0;
  private rafScheduled = false;
  private frames = 0;
  private password = '';
  private connectedAt = 0;
  private lastFrameAt = 0;
  private authSent = false;
  private lastMoveAt = 0;
  private pendingMove: { x: number; y: number } | null = null;
  private moveFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private latencyEma = 0;
  private adaptiveAt = 0;
  /** Reused pointer payload to cut GC pressure */
  private readonly moveMsg = {
    type: 'pointer' as const,
    action: 'move' as const,
    x: 0,
    y: 0,
    button: 'left',
    dx: 0,
    dy: 0,
  };

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
    this.lastMoveAt = 0;
    this.pendingMove = null;
    this.latencyEma = 0;
    this.adaptiveAt = 0;

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
      this.sendPreferJson();
      this.sendAuthOnce();
    };

    ws.onmessage = (ev) => {
      if (this.disposed) return;
      const data = ev.data;
      if (typeof data === 'string') {
        // HOT PATH: frames are huge — never JSON.parse them
        const b64 = extractFrameBase64(data);
        if (b64 !== null) {
          this.emitUri(frameDataToUri(b64), b64.length);
          return;
        }
        const msg = decodeMsg(data);
        if (msg) this.handleJson(msg);
        return;
      }
      void this.onBinary(data);
    };

    ws.onerror = () => {
      if (this.disposed) return;
      this.setState('error', 'Connection error — check IP, port, Wi‑Fi, and firewall');
    };

    ws.onclose = (ev) => {
      this.stopPing();
      this.stopFrameWatch();
      this.clearMoveFlush();
      if (this.disposed) return;
      if (this.state !== 'error') {
        this.setState('closed', ev.reason || (ev.code ? `code ${ev.code}` : 'Disconnected'));
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

  private async onBinary(data: unknown): Promise<void> {
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
      this.emitUri(jpegBytesToUri(jpeg), jpeg.byteLength);
    } catch {
      /* ignore */
    }
  }

  private handleJson(msg: ServerMsg): void {
    // Legacy fallback if extractFrameBase64 missed a variant
    if (msg.type === 'frame') {
      const data = (msg as { data?: string }).data;
      if (typeof data === 'string' && data.length > 0) {
        this.emitUri(frameDataToUri(data), data.length);
      }
      return;
    }

    this.events.onMessage(msg);

    switch (msg.type) {
      case 'hello': {
        const h = msg as { screen?: { width: number; height: number } };
        if (h.screen) this.events.onScreen(h.screen.width, h.screen.height);
        if (this.state === 'authenticating' || this.state === 'connecting') {
          this.sendPreferJson();
          if (!this.token) {
            this.authSent = false;
            this.sendAuthOnce();
          }
        }
        return;
      }
      case 'auth_ok': {
        const m = msg as { token?: string; screen?: { width: number; height: number } };
        this.token = m.token || null;
        if (m.screen) this.events.onScreen(m.screen.width, m.screen.height);
        this.connectedAt = Date.now();
        this.lastFrameAt = 0;
        this.setState('streaming');
        this.startPing();
        this.startFrameWatch();
        this.sendPreferJson();
        this.send({ type: 'keyframe' });
        return;
      }
      case 'auth_fail': {
        const m = msg as { message?: string };
        this.setState('error', m.message || 'Authentication failed');
        this.ws?.close();
        return;
      }
      case 'error': {
        const m = msg as { message?: string };
        this.setState('error', m.message || 'Server error');
        return;
      }
      case 'pong': {
        const m = msg as { t?: number };
        if (typeof m.t === 'number') {
          const ms = Math.max(0, Date.now() - m.t);
          this.latencyEma = this.latencyEma <= 0 ? ms : this.latencyEma * 0.7 + ms * 0.3;
          this.events.onLatency(ms);
          this.maybeAdaptQuality();
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * If Wi‑Fi latency climbs, gently ease quality so frames keep flowing.
   * Manual quality chips always win until the next auto nudge.
   */
  private maybeAdaptQuality(): void {
    if (this.state !== 'streaming') return;
    const now = Date.now();
    if (now - this.adaptiveAt < 4000) return;
    if (this.latencyEma < 90) return;
    this.adaptiveAt = now;
    // Mild ease — host also auto-eases encode when slow
    if (this.latencyEma >= 140) {
      this.setQuality({ fps: 24, scale: 0.74, jpeg_quality: 72 });
    } else {
      this.setQuality({ fps: 28, scale: 0.8, jpeg_quality: 76 });
    }
  }

  private emitUri(uri: string, bytes: number): void {
    this.frames += 1;
    this.lastFrameAt = Date.now();
    this.events.onFrameCount?.(this.frames);
    this.pendingUri = uri;
    this.pendingBytes = bytes;
    // First few frames: paint ASAP (no RAF wait) so session never "blank"
    if (this.frames <= 2) {
      this.rafScheduled = false;
      const next = this.pendingUri;
      const b = this.pendingBytes;
      this.pendingUri = null;
      this.pendingBytes = 0;
      this.events.onFrame(next, b);
      return;
    }
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
    const nx = clamp01(x);
    const ny = clamp01(y);

    if (action === 'move') {
      this.pendingMove = { x: nx, y: ny };
      const now = Date.now();
      const wait = MOVE_MIN_MS - (now - this.lastMoveAt);
      if (wait <= 0) {
        this.flushMove();
      } else if (!this.moveFlushTimer) {
        this.moveFlushTimer = setTimeout(() => {
          this.moveFlushTimer = null;
          this.flushMove();
        }, wait);
      }
      return;
    }

    this.flushMove();
    this.send({
      type: 'pointer',
      action,
      x: nx,
      y: ny,
      button: extra?.button || 'left',
      dx: extra?.dx || 0,
      dy: extra?.dy || 0,
    });
  }

  private flushMove(): void {
    if (!this.pendingMove || this.state !== 'streaming') return;
    const { x, y } = this.pendingMove;
    this.pendingMove = null;
    this.lastMoveAt = Date.now();
    this.moveMsg.x = x;
    this.moveMsg.y = y;
    this.send(this.moveMsg as unknown as Record<string, unknown>);
  }

  private clearMoveFlush(): void {
    if (this.moveFlushTimer) {
      clearTimeout(this.moveFlushTimer);
      this.moveFlushTimer = null;
    }
    this.pendingMove = null;
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
    this.clearMoveFlush();
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
      if (this.state !== 'streaming') return;
      if (this.frames > 0) {
        if (this.msSinceLastFrame > 3500) this.send({ type: 'keyframe' });
        return;
      }
      const waited = Math.round((Date.now() - this.connectedAt) / 1000);
      this.send({ type: 'keyframe' });
      if (waited >= 3 && waited - lastAlert >= 3) {
        lastAlert = waited;
        this.events.onFrameTimeout?.(waited);
      }
    }, 1800);
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
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
