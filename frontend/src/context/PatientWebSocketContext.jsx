import {
  createContext, useContext, useEffect, useRef, useState, useCallback,
} from 'react';
import { useAuth } from './AuthContext';

const WSContext = createContext(null);

/**
 * One shared notification WebSocket for the whole patient area. Mounted once
 * around the patient routes so every page reuses a single connection to
 * ws/notifications/<login_id>/ instead of opening its own.
 *
 * Pages opt in with `usePatientWS().subscribe(notif_type, cb)`, which returns an
 * unsubscribe function. The connection is best-effort: if the socket can't be
 * established it silently retries, and pages keep working via their REST polls.
 */
export function PatientWSProvider({ children }) {
  const { user } = useAuth();
  const loginId = user?.login_id;

  const wsRef = useRef(null);
  const listenersRef = useRef({});
  const reconnectRef = useRef(null);
  const closedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);

  const dispatch = useCallback((data) => {
    const type = data.notif_type || data.type || 'general';
    (listenersRef.current[type] || []).forEach((cb) => cb(data));
    (listenersRef.current.all || []).forEach((cb) => cb(data));
  }, []);

  useEffect(() => {
    if (!loginId) return undefined;
    closedRef.current = false;

    const connect = () => {
      let ws;
      try {
        ws = new WebSocket(`ws://localhost:8000/ws/notifications/${loginId}/`);
      } catch {
        return; // REST polling on each page still keeps data fresh.
      }
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Patient connected!');
        setConnected(true);
      };
      ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.message) {
          setNotifications((prev) => [
            { id: Date.now(), ...data, read: false },
            ...prev.slice(0, 49),
          ]);
        }
        dispatch(data);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closedRef.current) reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    connect();

    return () => {
      closedRef.current = true;
      clearTimeout(reconnectRef.current);
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
  }, [loginId, dispatch]);

  const subscribe = useCallback((type, callback) => {
    if (!listenersRef.current[type]) listenersRef.current[type] = [];
    listenersRef.current[type].push(callback);
    return () => {
      listenersRef.current[type] = (listenersRef.current[type] || []).filter((cb) => cb !== callback);
    };
  }, []);

  return (
    <WSContext.Provider value={{ connected, notifications, subscribe }}>
      {children}
    </WSContext.Provider>
  );
}

export const usePatientWS = () => useContext(WSContext);
