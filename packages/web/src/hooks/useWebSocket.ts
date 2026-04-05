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
  const isMounted = useRef(true);

  const connect = useCallback(() => {
    // Close any existing socket before reconnecting
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent triggering reconnect
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted.current) setConnected(true);
      };

      ws.onclose = () => {
        if (isMounted.current) {
          setConnected(false);
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (isMounted.current) setLastMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      if (isMounted.current) {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    }
  }, [url]);

  useEffect(() => {
    isMounted.current = true;
    connect();
    return () => {
      isMounted.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, lastMessage, send };
}
