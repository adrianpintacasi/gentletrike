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
    <div className="mt-2 rounded-lg border border-gray-700 bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
          Chat · {ride.passengerName ?? 'Passenger'}
        </span>
        <button onClick={onClose} className="text-gray-500 transition hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto p-2.5">
        {messages.length === 0 ? (
          <p className="py-3 text-center text-[11px] font-medium text-gray-500">
            No messages yet. Send a quick reply below.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] font-medium leading-snug ${
                m.sender === 'driver'
                  ? 'self-end bg-amber-400 text-gray-900'
                  : m.sender === 'system'
                    ? 'self-center bg-gray-800 text-gray-400'
                    : 'self-start bg-gray-800 text-white'
              }`}
            >
              <span className="whitespace-pre-line">{m.text}</span>
              {m.time && (
                <span className="mt-0.5 block text-[9px] opacity-60">{m.time}</span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Typing while driving is unsafe, so the common replies are one tap. */}
      <div className="flex gap-1.5 overflow-x-auto border-t border-gray-800 px-2.5 py-2">
        {quickReplies.map((q) => (
          <button
            key={q}
            onClick={() => api.sendMessage(ride.id, 'driver', q).then(poll).catch(() => {})}
            className="shrink-0 rounded-md bg-gray-800 px-2 py-1 text-[10px] font-bold text-gray-300 transition hover:bg-gray-700"
          >
            {q}
          </button>
        ))}
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-gray-800 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message passenger..."
          className="min-w-0 flex-1 rounded-lg bg-gray-800 px-2.5 py-2 text-[11px] font-medium text-white placeholder:text-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-400 text-gray-900 transition active:scale-95 disabled:bg-gray-700 disabled:text-gray-500"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
};
