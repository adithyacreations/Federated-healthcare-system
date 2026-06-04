import { useState } from 'react';
import useChat from './useChat';
import { useAuth } from '../../context/AuthContext';

/**
 * Compact chat window the hospital opens from the "Contact Vendor" modal.
 * Wraps useChat, renders the same bubble UI vendors see, but flips sender
 * sides (hospital messages → right, vendor messages → left).
 */
const HospitalChatWindow = ({ chatId, vendorName, orderRef }) => {
  const { user } = useAuth();
  const userLoginId = user?.login_id || user?.login_id_id;

  const [draft, setDraft] = useState('');
  const { messages, sending, send, messagesEndRef } = useChat({
    chatId, userType: 'hospital', userLoginId,
  });

  const onSend = async () => {
    if (!draft.trim()) return;
    const ok = await send(draft);
    if (ok) setDraft('');
  };

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-white">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm"
          style={{ backgroundColor: '#F97316' }}
        >
          {vendorName?.charAt(0) || 'V'}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{vendorName || 'Vendor'}</p>
          {orderRef && (
            <p className="text-xs text-gray-400 truncate">Re: Order #{orderRef}</p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ backgroundColor: '#FAF7F2' }}>
        {messages.length === 0 ? (
          <p className="text-center text-gray-400 text-sm mt-8">Send the first message ✍️</p>
        ) : messages.map((msg) => {
          // From the hospital's POV, their own messages render on the right.
          const mine = msg.sender_type === 'hospital';
          return (
            <div key={msg.message_id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                  mine ? 'text-white rounded-tr-sm' : 'bg-white text-black rounded-tl-sm shadow-sm'
                }`}
                style={mine ? { backgroundColor: '#F97316' } : {}}
              >
                <p>{msg.message}</p>
                <p className={`text-[10px] mt-1 text-right ${mine ? 'text-orange-100' : 'text-gray-400'}`}>
                  {(() => { try { return new Date(msg.sent_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })()}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="bg-white px-3 py-2 border-t border-gray-100 flex gap-2 items-end">
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
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-orange-400"
        />
        <button
          onClick={onSend}
          disabled={!draft.trim() || sending}
          className="w-10 h-10 rounded-full flex items-center justify-center text-white disabled:opacity-50 flex-shrink-0"
          style={{ backgroundColor: '#F97316' }}
        >
          ➤
        </button>
      </div>
    </>
  );
};

export default HospitalChatWindow;
