import React, { useState } from 'react';
import { Sparkles, X, Send } from 'lucide-react';
import * as api from '../api';

interface GentleAiAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  pickupName?: string;
  dropoffName?: string;
}

export const GentleAiAssistant: React.FC<GentleAiAssistantProps> = ({
  isOpen,
  onClose,
  pickupName,
  dropoffName,
}) => {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    {
      role: 'assistant',
      text: 'Maayong adlaw! I am GentleTrike AI, your local Dumaguete guide. Ask me about pedicab fares, tourist spots like Rizal Boulevard or Casaroro Falls, Siquijor ferry schedules, or local food like Silvanas & Budbud Kabog!',
    },
  ]);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const quickQuestions = [
    'How much is pedicab fare from Silliman to Boulevard?',
    'How do I go from Dumaguete to Valencia Casaroro Falls?',
    'What time do Siquijor ferries depart from Pier 1?',
    'Useful Visayan phrases to say to pedicab drivers?',
  ];

  const handleSendQuery = async (queryText?: string) => {
    const q = queryText || prompt;
    if (!q.trim() || loading) return;

    const userMsg = { role: 'user' as const, text: q };
    setMessages((prev) => [...prev, userMsg]);
    setPrompt('');
    setLoading(true);

    try {
      const reply = await api.askAssistant({
        prompt: q,
        pickup: pickupName,
        dropoff: dropoffName,
      });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: reply || 'Safe travels around Dumaguete!' },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Dumaguete Pedicab standard fare is ₱15 for 1km or less, plus ₱2 for each succeeding kilometer (rounded to nearest peso). Enjoy your ride in GentleTrike!',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-lg w-full h-[85vh] max-h-[620px] shadow-2xl border border-gray-200 flex flex-col text-gray-900 overflow-hidden">
        {/* Header */}
        <div className="bg-gray-900 text-amber-400 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-400 text-gray-900 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight text-white">GentleTrike AI Guide</h3>
              <p className="text-xs text-gray-400 font-medium">Dumaguete Route & City Knowledge</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-800 rounded-full transition text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages Body */}
        <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 bg-gray-50 text-xs font-medium">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-xl max-w-[88%] whitespace-pre-line leading-relaxed shadow-xs ${
                m.role === 'user'
                  ? 'bg-gray-900 text-amber-400 self-end font-semibold'
                  : 'bg-white border border-gray-200 text-gray-900 self-start'
              }`}
            >
              {m.text}
            </div>
          ))}

          {loading && (
            <div className="bg-white border border-gray-200 p-3 rounded-xl self-start flex items-center gap-2 text-gray-800 font-semibold animate-pulse">
              <Sparkles className="w-4 h-4 text-amber-500 animate-spin" />
              <span>Consulting GentleTrike AI...</span>
            </div>
          )}
        </div>

        {/* Quick Chips */}
        <div className="p-2 bg-white border-t border-gray-100 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {quickQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => handleSendQuery(q)}
              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-xl text-[11px] font-bold text-amber-900 whitespace-nowrap transition"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendQuery();
          }}
          className="p-3 bg-white border-t border-gray-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask GentleTrike AI about Dumaguete pedicabs, fares, places..."
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 font-medium focus:outline-none focus:bg-white focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="p-2.5 bg-gray-900 text-amber-400 hover:bg-black disabled:bg-gray-200 disabled:text-gray-400 rounded-xl shadow-xs transition"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
