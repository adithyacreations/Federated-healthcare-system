import { useEffect, useRef, useState, useCallback } from 'react';
import API from '../../api/axios';

/**
 * Shared chat plumbing for both the vendor and hospital chat views.
 *
 *  - GET  /api/vendor/chat/<chat_id>/messages/  → load + mark as read
 *  - POST /api/vendor/chat/<chat_id>/messages/  → send (server pushes to peer)
 *  - WS   /ws/chat/<userType>/<userLoginId>/    → receive peer messages
 *
 * Returns the messages array, a send() helper, and a ref to scroll to the
 * latest message. The userType ('vendor' or 'hospital') tells the server which
 * group to subscribe to; userLoginId is the LoginCredentials primary key.
 */
const useChat = ({ chatId, userType, userLoginId }) => {
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, []);

  // Fetch history every time the active chat changes.
  useEffect(() => {
    if (!chatId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await API.get(`/api/vendor/chat/${chatId}/messages/`);
        if (!cancelled && r.data?.success) {
          setMessages(r.data.data || []);
          scrollToBottom();
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [chatId, scrollToBottom]);

  // One per-user WebSocket lives for the lifetime of the page (re-opened when
  // userType/userLoginId change). Inbound messages append only when they
  // belong to the currently selected chat.
  useEffect(() => {
    if (!userLoginId || !userType) return undefined;
    let socket;
    try {
      socket = new WebSocket(`ws://localhost:8000/ws/chat/${userType}/${userLoginId}/`);
    } catch {
      return undefined;
    }
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'chat_message') return;
        // The WS payload carries the chat_id — only render if it matches the
        // chat the user is currently looking at; otherwise the parent should
        // refresh its chat list to bump the unread counter.
        if (data.chat_id !== chatId) return;
        setMessages((prev) => {
          // Avoid double-render of an echo when our own send already inserted it.
          if (prev.some((m) => m.message_id === data.message_id)) return prev;
          return [...prev, {
            message_id: data.message_id,
            sender_type: data.sender_type,
            message: data.message,
            sent_at: data.sent_at,
          }];
        });
        scrollToBottom();
      } catch { /* ignore */ }
    };
    socket.onerror = () => {};
    wsRef.current = socket;
    return () => { try { socket.close(); } catch { /* noop */ } };
  }, [userType, userLoginId, chatId, scrollToBottom]);

  const send = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || !chatId) return false;
    setSending(true);
    try {
      const r = await API.post(`/api/vendor/chat/${chatId}/messages/`, { message: trimmed });
      if (r.data?.success) {
        setMessages((prev) => [...prev, r.data.data]);
        scrollToBottom();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSending(false);
    }
  }, [chatId, scrollToBottom]);

  return { messages, sending, send, messagesEndRef, scrollToBottom };
};

export default useChat;
