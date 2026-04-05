import { useState, useEffect, useRef, useCallback } from "react";

interface WebSocketState {
  connected: boolean;
  lastMessage: { type: string; data?: unknown } | null;
  send: (data: unknown) => void;
}

export function useWebSocket(url: string): WebSocketState {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<{ type: string; data?: unknown } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onclose = () => {
        setConnected(false);
        // Auto-reconnect after 3 seconds
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          setLastMessage(msg);
        } catch {
          // Ignore
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Server not available
      reconnectTimer.current = setTimeout(connect, 3000);
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, lastMessage, send };
}
