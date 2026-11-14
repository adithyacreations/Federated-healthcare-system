import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

// The chatbot is used by guests on the landing page too, so it must NOT use the
// shared `API` instance — that one force-logs-out and redirects to /login on a
// 401. We call the backend directly and attach the token only when present.
const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const SUGGESTIONS = [
  'What is FederCare?',
  'How to book a consultation?',
  'What is Federated Learning?',
  'How does Emergency SOS work?',
  'What AI models are used?',
];

const formatTime = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function FederCareChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Hello! 👋 I am FederCare Assistant. I can help you with:\n\n• Questions about FederCare platform\n• General medical information\n• How to use any feature\n\nHow can I help you today?',
      time: formatTime(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messageListRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  // Drag logic for the chatbot button
  const [btnPos, setBtnPos] = useState({ right: 24, bottom: 24 });
  const [isDraggingBtn, setIsDraggingBtn] = useState(false);
  const dragRef = useRef({ isDragging: false, wasDragged: false, startX: 0, startY: 0, initRight: 24, initBottom: 24 });

  const handlePointerDown = (e) => {
    if (isOpen) return;
    dragRef.current.isDragging = false;
    dragRef.current.wasDragged = false;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.initRight = btnPos.right;
    dragRef.current.initBottom = btnPos.bottom;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      dragRef.current.isDragging = true;
      dragRef.current.wasDragged = true;
      setIsDraggingBtn(true);
    }
    if (dragRef.current.isDragging) {
      setBtnPos({
        right: Math.max(0, Math.min(dragRef.current.initRight - dx, window.innerWidth - 64)),
        bottom: Math.max(0, Math.min(dragRef.current.initBottom - dy, window.innerHeight - 64))
      });
    }
  };

  const handlePointerUp = (e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragRef.current.isDragging) {
      const PADDING = 24;
      const maxRight = Math.max(PADDING, window.innerWidth - 64 - PADDING);
      const maxBottom = Math.max(PADDING, window.innerHeight - 64 - PADDING);

      const targetRight = btnPos.right > (maxRight / 2) ? maxRight : PADDING;
      const targetBottom = btnPos.bottom > (maxBottom / 2) ? maxBottom : PADDING;

      setBtnPos({ right: targetRight, bottom: targetBottom });
      dragRef.current.isDragging = false;
      setIsDraggingBtn(false);
    }
  };

  const handleClick = (e) => {
    if (dragRef.current.wasDragged) {
      e.preventDefault();
      dragRef.current.wasDragged = false;
      return;
    }
    if (isOpen) {
      closeChat();
    } else {
      setIsOpen(true);
    }
  };

  const closeChat = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  useEffect(() => {
    const list = messageListRef.current;
    if (list && messages.length > 1) list.scrollTop = list.scrollHeight;
  }, [messages, loading, isOpen, isMinimized]);

  useEffect(() => {
    const panel = panelRef.current;
    const viewport = window.visualViewport;
    if (!panel || !viewport || !isOpen || isMinimized) return;

    const updateViewport = () => {
      const keyboardInset = Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height);
      panel.style.setProperty('--chat-bottom', `${keyboardInset ? keyboardInset + 8 : 72}px`);
      panel.style.setProperty('--chat-height', `${viewport.height}px`);
    };
    updateViewport();
    viewport.addEventListener('resize', updateViewport);
    viewport.addEventListener('scroll', updateViewport);
    return () => {
      viewport.removeEventListener('resize', updateViewport);
      viewport.removeEventListener('scroll', updateViewport);
    };
  }, [isOpen, isMinimized]);

  useEffect(() => {
    if (!input && inputRef.current) inputRef.current.style.height = 'auto';
  }, [input]);

  const sendMessage = async (overrideText) => {
    const userMessage = (overrideText ?? input).trim();
    if (!userMessage || loading) return;

    setInput('');
    const newUserMsg = { role: 'user', content: userMessage, time: formatTime() };
    const historySnapshot = messages;
    setMessages((prev) => [...prev, newUserMsg]);
    setLoading(true);

    try {
      // Map prior turns to the backend's {role, text} shape (skip the greeting),
      // capped to the last 10 turns to keep the payload small. The Gemini key and
      // system prompt both live on the server, never in the browser.
      const history = historySnapshot
        .slice(1)
        .slice(-10)
        .map((msg) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          text: msg.content,
        }));

      // Attach the token only if the user is logged in (gets the higher limit);
      // guests send no auth header and the endpoint still answers them.
      const token = localStorage.getItem('access_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await axios.post(
        `${BASE_URL}/api/ai/chat/`,
        { message: userMessage, history },
        { headers }
      );

      const text = res.data?.success ? res.data.data?.reply : null;
      if (!text) throw new Error(res.data?.message || 'Empty response from AI');

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: text, time: formatTime() },
      ]);
    } catch (error) {
      console.error('Chat error:', error);
      const rateLimited = error.response?.status === 429;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: rateLimited
            ? (error.response?.data?.message
              || 'Chat limit reached. Please try again later.')
            : 'Sorry, I am having trouble connecting right now. Please try again! 🔄',
          time: formatTime(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Strip Markdown `**bold**` (Gemini emits it freely) and normalise list markers
  // so the user sees clean prose with proper bullets — no raw `*` left behind.
  const cleanLine = (line) =>
    line
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/^\s*\*\s+/, '• ')
      .replace(/^\s*-\s+/, '• ')
      .trim();

  const formatMessage = (text) => {
    if (!text) return null;
    const lines = text.split('\n').map(cleanLine).filter((l) => l.length > 0);
    return lines.map((line, i) => (
      <p
        key={i}
        className={`leading-relaxed ${line.startsWith('•') ? 'pl-2' : ''} ${i > 0 ? 'mt-1' : ''}`}
      >
        {line}
      </p>
    ));
  };

  return (
    <>
      <button
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
        aria-label={isOpen ? 'Close chat bubble' : 'Open chat bubble'}
        aria-expanded={isOpen}
        className={`fixed z-[61] flex items-center justify-center rounded-full bg-orange-500 text-white shadow-2xl hover:bg-orange-600 touch-none ${isOpen ? 'h-12 w-12 sm:hidden' : 'h-16 w-16 hover:scale-110'}`}
        style={{
          right: isOpen ? '12px' : `${btnPos.right}px`,
          bottom: isOpen ? 'max(12px, env(safe-area-inset-bottom))' : `${btnPos.bottom}px`,
          transition: isOpen || isDraggingBtn ? 'none' : 'all 0.3s ease'
        }}
        title={isOpen ? 'Close chat bubble' : 'Chat with FederCare Assistant'}
      >
        {isOpen ? <span aria-hidden="true" className="text-xl">✕</span> : <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>}
        {!isOpen && <span className="absolute top-0 right-0 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse" />}
      </button>

      {isOpen && (
        <section
          ref={panelRef}
          aria-label="FederCare Assistant"
          className={`fixed inset-x-3 z-[60] flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl sm:left-auto sm:right-6 sm:w-96 ${isMinimized
            ? 'bottom-[max(72px,calc(env(safe-area-inset-bottom)+60px))] sm:bottom-6'
            : 'bottom-[max(var(--chat-bottom,72px),calc(env(safe-area-inset-bottom)+60px))] h-[min(32rem,calc(var(--chat-height,100dvh)-84px))] sm:bottom-6 sm:h-[600px] sm:max-h-[calc(100dvh-3rem)]'
          }`}
        >
          {/* Header */}
          <div
            className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4"
            style={{backgroundColor: '#FAF7F2', borderBottom: '1px solid #E5E5E5' }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="w-9 h-9 shrink-0 rounded-full bg-orange-500 flex items-center justify-center text-xl text-white">
                ⚕️
              </div>
              <div>
                <p className="font-semibold text-sm text-black">FederCare Assistant</p>
                <p className="text-xs flex items-center gap-1" style={{color: '#666666' }}>
                  <span className="w-2 h-2 rounded-full inline-block" style={{backgroundColor: '#22C55E' }} />
                  Online • AI Powered
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="text-black/70 hover:text-black w-11 h-11 flex items-center justify-center rounded-lg hover:bg-black/5"
                aria-label={isMinimized ? 'Expand chat' : 'Minimize chat'}
                aria-expanded={!isMinimized}
              >
                {isMinimized ? '▲' : '▼'}
              </button>

              <button
                onClick={closeChat}
                className="text-black/70 hover:text-black w-11 h-11 flex items-center justify-center rounded-lg hover:bg-black/5"
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              <div ref={messageListRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-gray-50 p-3 sm:p-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm mr-2 flex-shrink-0 mt-1">
                        ⚕️
                      </div>
                    )}

                    <div
                      className={`min-w-0 max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${msg.role === 'user'
                        ? 'bg-orange-500 text-white rounded-tr-sm'
                        : 'bg-white text-gray-800 rounded-tl-sm shadow-sm border border-gray-200'
                        }`}
                    >
                      <div className="leading-relaxed">
                        {formatMessage(msg.content)}
                      </div>
                      <p
                        className={`text-xs mt-1 ${msg.role === 'user' ? 'text-orange-100' : 'text-gray-400'
                          } text-right`}
                      >
                        {msg.time}
                      </p>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm mr-2">
                      ⚕️
                    </div>
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-200">
                      <div className="flex gap-1 items-center h-5">
                        <div
                          className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
                          style={{animationDelay: '0ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
                          style={{animationDelay: '150ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
                          style={{animationDelay: '300ms' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {messages.length === 1 && (
                  <div className="pt-1">
                    <p className="text-xs text-gray-400 mb-2">Quick questions:</p>
                    <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 sm:flex-wrap">
                      {SUGGESTIONS.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => sendMessage(s)}
                          className="min-h-[44px] shrink-0 whitespace-nowrap text-xs bg-orange-50 text-orange-600 px-3 py-1.5 rounded-full hover:bg-orange-100 border border-orange-200 transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-gray-100 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyPress}
                    aria-label="Message FederCare Assistant"
                    placeholder="Type a message…"
                    rows={1}
                    className="min-w-0 flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 max-h-24"
                    style={{minHeight: '44px' }}
                    onInput={(e) => {
                      e.target.style.height = 'auto';
                      e.target.style.height =
                        Math.min(e.target.scrollHeight, 96) + 'px';
                    }}
                  />
                  <button
                    onClick={() => sendMessage()}
                    aria-label="Send message"
                    disabled={!input.trim() || loading}
                    className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${input.trim() && !loading
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                  >
                    {loading ? (
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="mt-2 hidden text-center text-xs text-gray-400 sm:block">
                  Powered by Gemini AI • FederCare Assistant
                </p>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
