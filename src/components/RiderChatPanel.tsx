import React, { useCallback, useState } from 'react';
import { Send, X } from 'lucide-react';
import * as api from '../api';
import { ChatMessage, RideBooking } from '../types';
import { usePolling } from '../hooks/usePolling';

/**
 * The rider's half of the trip chat.
 *
 * Passengers could already message a rider, but nothing on the rider's screen
 * received it — a one-way channel is worse than none, since the passenger sees
 * their question delivered and never answered.
 *
 * Sends as 'driver' where the passenger view sends as 'user', so the same
 * thread reads correctly from both sides.
 */
interface RiderChatPanelProps {
  ride: RideBooking;
  onClose: () => void;
}

const formatTime = (iso: string) => {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const RiderChatPanel: React.FC<RiderChatPanelProps> = ({ ride, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  const poll = useCallback(async () => {
    try {
      const rows = await api.listMessages(ride.id);
      setMessages(
        rows.map((m) => ({
          id: m.id,
          sender: m.sender as ChatMessage['sender'],
          text: m.text,
          time: formatTime(m.time),
        }))
      );
    } catch {
      /* keep whatever thread we already have */
    }
  }, [ride.id]);

  usePolling(poll, 3000, true);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    setInput('');
    // Echo immediately so the rider sees it land; the next poll replaces this
    // with the server's copy.
    setMessages((prev) => [
      ...prev,
      { id: `pending_${Date.now()}`, sender: 'driver', text, time: 'Sending...' },
    ]);

    try {
      await api.sendMessage(ride.id, 'driver', text);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `failed_${Date.now()}`,
          sender: 'system',
          text: 'Message not sent — check your connection.',
          time: '',
        },
      ]);
    }
  };

  const quickReplies = [
    "I'm on the way",
    "I'm outside",
    'Please wait 2 minutes',
    'Where exactly are you?',
  ];

  return (
    <div className="mt-2 rounded-card border border-cream-400/20 bg-trust-slate/95">
      <div className="flex items-center justify-between border-b border-cream-400/20 px-3 py-2">
        <span className="text-[11px] font-display font-bold uppercase tracking-wider text-trike-gold">
          Chat · {ride.passengerName ?? 'Passenger'}
        </span>
        <button onClick={onClose} className="text-cream-400 transition hover:text-cream-50">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto p-2.5">
        {messages.length === 0 ? (
          <p className="py-3 text-center text-[11px] font-sans font-medium text-cream-400">
            No messages yet. Send a quick reply below.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-card px-2.5 py-1.5 text-[11px] font-medium leading-snug ${
                m.sender === 'driver'
                  ? 'self-end bg-trike-gold text-trust-slate font-semibold'
                  : m.sender === 'system'
                    ? 'self-center bg-cream-50/10 text-cream-300 rounded-pill'
                    : 'self-start bg-cream-50/15 border border-cream-400/20 text-cream-50'
              }`}
            >
              <span className="whitespace-pre-line">{m.text}</span>
              {m.time && (
                <span className="mt-0.5 block text-[9px] opacity-60 text-right">{m.time}</span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Quick replies */}
      <div className="flex gap-1.5 overflow-x-auto border-t border-cream-400/20 px-2.5 py-2">
        {quickReplies.map((q) => (
          <button
            key={q}
            onClick={() => api.sendMessage(ride.id, 'driver', q).then(poll).catch(() => {})}
            className="shrink-0 rounded-pill bg-cream-50/10 border border-cream-400/20 px-2.5 py-1 text-[10px] font-sans font-bold text-cream-200 transition hover:bg-cream-50/20"
          >
            {q}
          </button>
        ))}
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-cream-400/20 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message passenger..."
          className="min-w-0 flex-1 rounded-card bg-cream-50/10 border border-cream-400/20 px-2.5 py-2 text-[11px] font-sans text-cream-50 placeholder:text-cream-400 focus:outline-none focus:border-trike-gold"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="btn-primary flex h-9 w-9 shrink-0 items-center justify-center !rounded-card shadow-xs disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
};
