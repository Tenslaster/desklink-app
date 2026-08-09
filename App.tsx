import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { SessionScreen } from './src/screens/SessionScreen';
import { DeskLinkClient, type ConnectionState } from './src/services/DeskLinkClient';
import { qualityToStream, type QualityPreset } from './src/services/storage';

export default function App() {
  const clientRef = useRef<DeskLinkClient | null>(null);
  const [session, setSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [screenW, setScreenW] = useState(1920);
  const [screenH, setScreenH] = useState(1080);
  const [latency, setLatency] = useState<number | null>(null);
  const [status, setStatus] = useState('Idle');
  const [frameCount, setFrameCount] = useState(0);
  const [waitHint, setWaitHint] = useState<string | null>(null);
  const [clientTick, setClientTick] = useState(0);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>('balanced');
  const qualityRef = useRef<QualityPreset>('balanced');
  const frameCountTick = useRef(0);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      deactivateKeepAwake().catch(() => undefined);
    };
  }, []);

  const onState = useCallback((state: ConnectionState, detail?: string) => {
    const labels: Record<ConnectionState, string> = {
      idle: 'Idle',
      connecting: 'Connecting…',
      authenticating: 'Authenticating…',
      streaming: 'Connected',
      error: detail || 'Error',
      closed: detail || 'Disconnected',
    };
    setStatus(labels[state] || state);

    if (state === 'connecting' || state === 'authenticating') {
      setBusy(true);
      setError(null);
      setWaitHint(null);
    }
    if (state === 'streaming') {
      setBusy(false);
      setSession(true);
      setError(null);
      setWaitHint('Waiting for first frame from PC…');
      activateKeepAwakeAsync().catch(() => undefined);
      const stream = qualityToStream(qualityRef.current);
      setTimeout(() => {
        clientRef.current?.setQuality(stream);
      }, 40);
    }
    if (state === 'error') {
      setBusy(false);
      setError(detail || 'Connection failed');
      setSession(false);
      setWaitHint(null);
      deactivateKeepAwake().catch(() => undefined);
    }
    if (state === 'closed' || state === 'idle') {
      setBusy(false);
      if (state === 'closed') {
        setSession(false);
        setFrameUri(null);
        setFrameCount(0);
        setWaitHint(null);
        deactivateKeepAwake().catch(() => undefined);
      }
    }
  }, []);

  const ensureClient = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    const c = new DeskLinkClient({
      onState,
      onFrame: (uri) => {
        setFrameUri(uri);
        setWaitHint(null);
      },
      onScreen: (w, h) => {
        setScreenW(w);
        setScreenH(h);
      },
      onLatency: (ms) => setLatency(ms),
      onMessage: () => undefined,
      onFrameCount: (n) => {
        frameCountTick.current = n;
        if (n === 1 || n % 8 === 0) {
          setFrameCount(n);
        }
      },
      onFrameTimeout: (seconds) => {
        setWaitHint(
          `No screen after ${seconds}s. Keep host open, same Wi‑Fi, firewall allows port.`,
        );
      },
    });
    clientRef.current = c;
    setClientTick((n) => n + 1);
    return c;
  }, [onState]);

  const handleConnect = (host: string, port: number, password: string, quality: QualityPreset) => {
    setError(null);
    setFrameUri(null);
    setFrameCount(0);
    setWaitHint(null);
    frameCountTick.current = 0;
    qualityRef.current = quality;
    setQualityPreset(quality);
    const c = ensureClient();
    c.connect(host, port, password);
  };

  const handleDisconnect = () => {
    clientRef.current?.disconnect();
    setSession(false);
    setFrameUri(null);
    setLatency(null);
    setFrameCount(0);
    setWaitHint(null);
    setBusy(false);
    deactivateKeepAwake().catch(() => undefined);
  };

  void clientTick;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {session && clientRef.current ? (
        <SessionScreen
          client={clientRef.current}
          frameUri={frameUri}
          screenW={screenW}
          screenH={screenH}
          latencyMs={latency}
          status={status}
          frameCount={frameCount}
          waitHint={waitHint}
          qualityPreset={qualityPreset}
          onQualityChange={(q) => {
            qualityRef.current = q;
            setQualityPreset(q);
          }}
          onDisconnect={handleDisconnect}
        />
      ) : (
        <ConnectScreen onConnect={handleConnect} busy={busy} error={error} />
      )}
    </SafeAreaProvider>
  );
}
