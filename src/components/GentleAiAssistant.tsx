import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, MapPin, Check, Ban } from 'lucide-react';
import * as api from '../api';
import { RideBooking } from '../types';
import { VEHICLE_DETAILS } from '../data/dumagueteData';

/** Prior turns sent as context. Six covers normal follow-ups without bloating cost. */
const MAX_HISTORY_TURNS = 6;

/**
 * Render the light Markdown the model emits — `**bold**`, `*italic*`, `` `code` ``.
 *
 * Built by hand rather than pulled from a library for two reasons: the bundle is
 * already near 1 MB, and this returns React nodes instead of HTML. Model output
 * is untrusted text; feeding it to dangerouslySetInnerHTML would turn a prompt
 * injection into script execution. Anything unmatched stays literal.
 */
function renderMarkdown(text: string): React.ReactNode[] {
  const pattern = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    if (match[1] !== undefined) {
      nodes.push(<strong key={key++} className="font-bold">{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<em key={key++}>{match[2]}</em>);
    } else {
      nodes.push(
        <code key={key++} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px]">
          {match[3]}
        </code>
      );
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * A ride Gently has proposed but nobody has agreed to yet.
 *
 * Gently is never allowed to book on its own — creating a ride dispatches real
 * drivers and commits the passenger to a fare, so the model's `draft_booking`
 * tool only ever produces this. It becomes a booking when the passenger presses
 * Confirm below, and not before.
 */
type DraftState = 'pending' | 'booking' | 'booked' | 'declined';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  draft?: api.CreateRideInput;
  draftState?: DraftState;
  error?: string;
}

interface GentleAiAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  pickupName?: string;
  dropoffName?: string;
  /** Only passengers can hold a booking; riders and staff see the draft read-only. */
  canBook?: boolean;
  /** Why booking is unavailable, so the card explains the real reason. */
  bookBlockedReason?: string;
  /** Hands the created ride back to the app so it can track it like any other. */
  onRideBooked?: (ride: RideBooking) => void;
  /**
   * Where the passenger is standing.
   *
   * Gently resolves place names near this point, which is what makes "the mall"
   * mean the one down the road rather than whichever mall matched the word best.
   */
  position?: { lat: number; lng: number } | null;
}

export const GentleAiAssistant: React.FC<GentleAiAssistantProps> = ({
  isOpen,
  onClose,
  pickupName,
  dropoffName,
  canBook = false,
  bookBlockedReason,
  onRideBooked,
  position,
}) => {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Maayong adlaw! I am Gently. Ask me what a trip should cost, how to reach somewhere, or what is worth seeing nearby — or ask me to book you a ride.',
    },
  ]);
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * Keep the newest message in view.
   *
   * Declared above the `isOpen` early return — hooks cannot run conditionally,
   * so moving this below it would break on the render where the panel closes.
   * `loading` is a dependency because the "Gently is thinking..." row changes
   * the scroll height too.
   */
  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading, isOpen]);

  // Opening the panel should land at the bottom immediately, with no animation
  // replaying the whole transcript.
  useEffect(() => {
    if (!isOpen) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isOpen]);

  if (!isOpen) return null;

  /*
   * Openers that work wherever the app is opened.
   *
   * These used to name Silliman, Rizal Boulevard and Dumaguete festivals, which
   * made the first thing a passenger saw a set of questions about a city they
   * may never have been to. Gently resolves "here" and "near me" against their
   * actual position, so the prompts can ask about where they are without
   * naming anywhere at all.
   */
  const quickQuestions = [
    'Where am I right now?',
    'How much is a pedicab fare per kilometre?',
    'How much from here to the mall?',
    'What can I see near here?',
    'How do I report an overcharging driver?',
  ];

  const handleSendQuery = async (queryText?: string) => {
    const q = queryText || prompt;
    if (!q.trim() || loading) return;

    // Everything already on screen becomes context for this turn. Index 0 is the
    // canned greeting, which carries no information and only costs tokens.
    // The server trims again; this cap just avoids sending a long transcript.
    const history = messages
      .slice(1)
      .slice(-MAX_HISTORY_TURNS)
      .map(({ role, text }) => ({ role, text }));

    const userMsg: Message = { role: 'user', text: q };
    setMessages((prev) => [...prev, userMsg]);
    setPrompt('');
    setLoading(true);

    try {
      const res = await api.askAssistant({
        prompt: q,
        pickup: pickupName,
        dropoff: dropoffName,
        history,
        ...(position && { lat: position.lat, lng: position.lng }),
      });

      const draft = api.findBookingDraft(res.data);

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: res.reply || 'Safe travels around Dumaguete!',
          ...(draft ? { draft, draftState: 'pending' as const } : {}),
        },
      ]);
    } catch (err) {
      console.error(err);
      // Deliberately quotes no fare. A canned number here would be exactly the
      // guessed figure the tool layer exists to prevent.
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Pasensya na — I could not reach my knowledge base just now. Please try again in a moment.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const setDraftState = (idx: number, draftState: DraftState, error?: string) =>
    setMessages((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, draftState, error } : m))
    );

  /**
   * The only path from a Gently draft to a real ride.
   *
   * Note what is *not* sent: no passenger id. The server takes that from the
   * session on /rides, so a draft cannot book a trip for anyone but the person
   * pressing this button.
   */
  const handleConfirmDraft = async (idx: number) => {
    const draft = messages[idx]?.draft;
    if (!draft) return;

    setDraftState(idx, 'booking');
    try {
      const ride = await api.createRide(draft);
      setDraftState(idx, 'booked');
      onRideBooked?.(ride);
      onClose();
    } catch (err) {
      console.error(err);
      setDraftState(
        idx,
        'pending',
        err instanceof api.ApiError && err.status === 401
          ? 'Please sign in as a passenger to book.'
          : 'Could not send the booking. Check your connection and try again.'
      );
    }
  };

  const renderDraft = (m: Message, idx: number) => {
    const d = m.draft!;
    const vehicle = VEHICLE_DETAILS[d.vehicleType]?.title ?? d.vehicleType;

    if (m.draftState === 'booked') {
      // Deliberately past tense. This card is a record of the tap, not a live
      // status — the trip may since have been accepted, completed, or cancelled,
      // and the trip screen is the only thing that actually knows.
      return (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-[11px] font-bold text-green-800">
          <Check className="h-4 w-4 shrink-0" />
          Ride requested. See the trip screen for its status.
        </div>
      );
    }

    if (m.draftState === 'declined') {
      return (
        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-[11px] font-semibold text-gray-500">
          Draft dismissed. Nothing was booked.
        </div>
      );
    }

    const busy = m.draftState === 'booking';

    return (
      <div className="mt-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
        <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-amber-800">
          Not booked yet — please review
        </p>

        <div className="space-y-1.5 text-[11px] font-semibold text-gray-800">
          <div className="flex items-start gap-1.5">
            <MapPin className="mt-px h-3.5 w-3.5 shrink-0 text-gray-500" />
            <span>
              {d.pickupLocation.name} → {d.dropoffLocation.name}
            </span>
          </div>
          <div className="text-gray-600">
            {vehicle} · {d.passengers} passenger{d.passengers > 1 ? 's' : ''} ·{' '}
            {d.distanceKm} km · ~{d.estimatedMinutes} min
          </div>
          <div className="text-sm font-black text-gray-900">₱{d.totalFare} · {d.paymentMethod}</div>
        </div>

        {m.error && <p className="mt-2 text-[11px] font-bold text-red-600">{m.error}</p>}

        {canBook ? (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => handleConfirmDraft(idx)}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-[11px] font-bold text-amber-400 transition hover:bg-black disabled:bg-gray-300 disabled:text-gray-500"
            >
              <Check className="h-3.5 w-3.5" />
              {busy ? 'Booking...' : 'Confirm booking'}
            </button>
            <button
              onClick={() => setDraftState(idx, 'declined')}
              disabled={busy}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        ) : (
          <p className="mt-3 text-[11px] font-semibold text-gray-500">
            {bookBlockedReason ?? 'Sign in as a passenger to book this ride.'}
          </p>
        )}
      </div>
    );
  };

  /*
   * A sheet on a phone, a dialog on a desktop.
   *
   * It was 85vh of a centred card at every width, so on a phone it covered the
   * map, the booking, and everything else the question was probably about — you
   * could not read your own fare while asking about it. Anchored to the bottom
   * it behaves like every other sheet in the app and leaves the top of the
   * screen showing whatever you were looking at.
   */
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs animate-fadeIn sm:items-center sm:p-4">
      <div className="flex h-[72dvh] max-h-[620px] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white text-gray-900 shadow-2xl sm:h-[80vh] sm:rounded-3xl">
        {/* Header */}
        <div className="gt-gently-header relative flex items-center justify-between overflow-hidden p-4 text-amber-400">
          <div className="flex items-center gap-3">
            {/* Pulses only while a reply is being composed, so the motion
                means something rather than decorating idle time. */}
            <div
              className={`rounded-xl bg-amber-400 p-2 text-gray-900 shadow-lg shadow-amber-400/30 ${
                loading ? 'gt-thinking' : ''
              }`}
            >
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight text-white">Gently</h3>
              <p className="text-[11px] font-medium text-white/60">Routes, fares and local knowledge</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Close Gently"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Messages Body */}
        <div
          ref={scrollRef}
          className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 bg-gray-50 text-xs font-medium"
        >
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-xl max-w-[88%] leading-relaxed shadow-xs ${
                m.role === 'user'
                  ? 'bg-gray-900 text-amber-400 self-end font-semibold'
                  : 'bg-white border border-gray-200 text-gray-900 self-start'
              }`}
            >
              <span className="whitespace-pre-line">{renderMarkdown(m.text)}</span>
              {m.draft && renderDraft(m, idx)}
            </div>
          ))}

          {loading && (
            <div className="bg-white border border-gray-200 p-3 rounded-xl self-start flex items-center gap-2 text-gray-800 font-semibold animate-pulse">
              <Sparkles className="w-4 h-4 text-amber-500 animate-spin" />
              <span>Gently is thinking...</span>
            </div>
          )}

          {/* Scroll anchor — kept last so new messages and the draft card are visible. */}
          <div ref={endRef} />
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
            placeholder="Ask about fares, routes or places..."
            className="gt-field flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 font-medium text-gray-900 focus:border-amber-400 focus:bg-white focus:outline-none"
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
