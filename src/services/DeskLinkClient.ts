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
};

export class DeskLinkClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private token: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPingT = 0;
  private disposed = false;
  /** Drop intermediate frames if decode is behind */
  private frameBusy = false;
  private pendingUri: string | null = null;

  constructor(private readonly events: ClientEvents) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  connect(host: string, port: number, password: string): void {
    this.disconnect();
    this.disposed = false;
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
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (this.disposed) return;
      this.setState('authenticating');
      // Wait for hello; still send auth (server accepts either order after hello)
      this.send({ type: 'auth', password });
    };

    ws.onmessage = (ev) => {
      if (this.disposed) return;
      if (typeof ev.data === 'string') {
        const msg = decodeMsg(ev.data);
        if (!msg) return;
        this.handleJson(msg, password);
        return;
      }
      // Binary frame
      const buf = ev.data as ArrayBuffer;
      const jpeg = unpackFrame(buf);
      if (!jpeg) return;
      this.handleJpeg(jpeg);
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

  private handleJson(msg: ServerMsg, password: string): void {
    this.events.onMessage(msg);

    if (msg.type === 'hello') {
      const h = msg as { screen?: { width: number; height: number } };
      if (h.screen) this.events.onScreen(h.screen.width, h.screen.height);
      // Re-send auth in case server wasn't ready
      if (this.state === 'authenticating' || this.state === 'connecting') {
        this.send({ type: 'auth', password });
      }
      return;
    }

    if (msg.type === 'auth_ok') {
      const m = msg as {
        token?: string;
        screen?: { width: number; height: number };
      };
      this.token = m.token || null;
      if (m.screen) this.events.onScreen(m.screen.width, m.screen.height);
      this.setState('streaming');
      this.startPing();
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

  private handleJpeg(jpeg: Uint8Array): void {
    // If UI is busy applying a frame, keep only the latest
    const uri = jpegBytesToUri(jpeg);
    if (this.frameBusy) {
      this.pendingUri = uri;
      return;
    }
    this.frameBusy = true;
    this.events.onFrame(uri, jpeg.byteLength);
    // Release on next tick so React can paint
    queueMicrotask(() => {
      this.frameBusy = false;
      if (this.pendingUri) {
        const next = this.pendingUri;
        this.pendingUri = null;
        this.frameBusy = true;
        this.events.onFrame(next, 0);
        queueMicrotask(() => {
          this.frameBusy = false;
        });
      }
    });
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
    this.send({ type: 'text', text: text.slice(0, 256) });
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
      this.lastPingT = Date.now();
      this.send({ type: 'ping', t: this.lastPingT });
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
