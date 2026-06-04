import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { FiSearch, FiSend } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useChat from '../../components/chat/useChat';
import { useAuth } from '../../context/AuthContext';
import { pageVariants } from '../../components/dashboard/variants';
import { colorFor, initials } from './vendorHelpers';
import './vendor-design.css';

const fmtTime = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

const VendorMessagesPage = () => {
  const { user } = useAuth();
  const userLoginId = user?.login_id || user?.login_id_id;

  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');

  const { messages, sending, send, messagesEndRef } = useChat({
    chatId: selectedChat?.chat_id || null,
    userType: 'vendor',
    userLoginId,
  });

  const fetchChats = useCallback(async () => {
    try {
      const r = await API.get('/api/vendor/chats/');
      if (r.data?.success) setChats(r.data.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchChats(); }, [fetchChats]);

  useEffect(() => {
    if (!messages.length) return;
    fetchChats();
  }, [messages, fetchChats]);

  const onSend = async () => {
    if (!draft.trim()) return;
    if (!selectedChat) { toast.error('Select a conversation first.'); return; }
    const ok = await send(draft);
    if (ok) setDraft('');
    else toast.error('Send failed.');
  };

  const filteredChats = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => (c.hospital_name || '').toLowerCase().includes(q));
  }, [chats, filter]);

  const totalUnread = chats.reduce((s, c) => s + (c.unread_count || 0), 0);
  const activeColors = selectedChat ? colorFor(selectedChat.hospital_name || 'Hospital') : null;

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible" className="v-scope v-page">
        <div className="v-page-head" style={{ marginBottom: 14 }}>
          <div>
            <h1 className="v-page-title">Messages</h1>
            <p className="v-page-sub">Real-time chat with hospitals on the FederCare network</p>
          </div>
          <div className="v-page-actions">
            <span className="v-btn-ghost" style={{ cursor: 'default' }}>
              {totalUnread} unread
            </span>
          </div>
        </div>

        <div className="v-chat">
          {/* List */}
          <div className="v-chat-list">
            <div className="v-chat-list-head">
              <h3>Inbox</h3>
              <span style={{ fontSize: 12, color: 'var(--v-ink-3)' }}>{chats.length} thread{chats.length === 1 ? '' : 's'}</span>
            </div>
            <div className="v-chat-search">
              <FiSearch style={{ width: 14, height: 14 }} />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search hospitals…" />
            </div>
            <div className="v-conv-scroll">
              {filteredChats.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--v-ink-3)' }}>
                  <p style={{ fontSize: 28, margin: '0 0 6px' }}>💬</p>
                  <p style={{ margin: 0, fontSize: 13 }}>No messages yet</p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--v-ink-4)' }}>
                    Hospitals will contact you about orders
                  </p>
                </div>
              ) : filteredChats.map((chat) => {
                const [a, b] = colorFor(chat.hospital_name || 'Hospital');
                const isActive = selectedChat?.chat_id === chat.chat_id;
                return (
                  <button
                    key={chat.chat_id}
                    type="button"
                    onClick={() => setSelectedChat(chat)}
                    className={`v-conv${isActive ? ' active' : ''}`}
                  >
                    <div className="v-conv-avatar" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
                      {initials(chat.hospital_name)}
                    </div>
                    <div className="v-conv-body">
                      <div className="v-conv-top">
                        <div className="v-conv-name">{chat.hospital_name}</div>
                      </div>
                      <div className="v-conv-preview">
                        {chat.last_message || 'No messages yet'}
                      </div>
                      {chat.order_ref && (
                        <div style={{ fontSize: 11, color: 'var(--v-orange)', marginTop: 2 }}>
                          Order #{String(chat.order_ref).slice(0, 8)}
                        </div>
                      )}
                    </div>
                    {chat.unread_count > 0 && (
                      <span className="v-conv-unread">{chat.unread_count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Thread */}
          <div className="v-thread">
            {!selectedChat ? (
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', background: 'var(--v-paper-tint)' }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 44, margin: '0 0 10px' }}>💬</p>
                  <p style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontWeight: 700, fontSize: 16, color: 'var(--v-ink)', margin: 0 }}>
                    Select a conversation
                  </p>
                  <p style={{ color: 'var(--v-ink-3)', fontSize: 13, marginTop: 6 }}>
                    Choose a hospital from the list to start chatting
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="v-thread-head">
                  <div
                    className="v-conv-avatar"
                    style={{ width: 38, height: 38, borderRadius: 10, fontSize: 13, background: `linear-gradient(135deg, ${activeColors[0]}, ${activeColors[1]})` }}
                  >
                    {initials(selectedChat.hospital_name)}
                  </div>
                  <div>
                    <h4>{selectedChat.hospital_name}</h4>
                    {selectedChat.order_ref && (
                      <div className="sub">Re: Order #{String(selectedChat.order_ref).slice(0, 8)}</div>
                    )}
                  </div>
                </div>

                <div className="v-thread-body">
                  {messages.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--v-ink-3)', fontSize: 13, marginTop: 24 }}>
                      Say hello 👋
                    </p>
                  ) : messages.map((msg) => {
                    const mine = msg.sender_type === 'vendor';
                    return (
                      <div key={msg.message_id} className={`v-msg${mine ? ' me' : ''}`}>
                        <div className="v-msg-av">
                          {mine ? 'ME' : initials(selectedChat.hospital_name)}
                        </div>
                        <div>
                          <div className="v-bubble">{msg.message}</div>
                          <div className="v-bubble-meta">{fmtTime(msg.sent_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                <div className="v-composer">
                  <div className="v-composer-row">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          onSend();
                        }
                      }}
                      placeholder="Type a message…"
                      rows={1}
                    />
                    <button type="button" onClick={onSend} disabled={!draft.trim() || sending} className="send" aria-label="Send">
                      <FiSend style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right context panel — only shows when a chat is selected */}
          {selectedChat && (
            <div className="v-thread-side">
              <div className="v-side-block">
                <div className="v-side-title">Hospital</div>
                <div className="v-side-row"><span className="k">Name</span><span className="v">{selectedChat.hospital_name}</span></div>
                {selectedChat.order_ref && (
                  <div className="v-side-row"><span className="k">Order</span><span className="v">#{String(selectedChat.order_ref).slice(0, 8)}</span></div>
                )}
                {selectedChat.unread_count > 0 && (
                  <div className="v-side-row"><span className="k">Unread</span><span className="v" style={{ color: 'var(--v-orange)' }}>{selectedChat.unread_count}</span></div>
                )}
              </div>
              <div className="v-side-block">
                <div className="v-side-title">Tips</div>
                <p style={{ fontSize: 12.5, color: 'var(--v-ink-3)', margin: 0, lineHeight: 1.5 }}>
                  Replies are delivered in real time via WebSocket. Mention the order ID when
                  asking about dispatch or OTP issues.
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </DashboardLayout>
  );
};

export default VendorMessagesPage;
