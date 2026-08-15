import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage, RideBooking } from '../types';
import {
  Phone,
  MessageSquare,
  ShieldAlert,
  Star,
  Send,
  X,
  AlertTriangle,
  BadgeCheck,
} from 'lucide-react';
import { TmoReportModal } from './TmoReportModal';
import { Portal } from './Portal';
import * as api from '../api';
import { usePolling } from '../hooks/usePolling';
import { getStreetRoute } from '../utils/dumagueteRouting';
import { useUnreadMessages } from '../hooks/useUnreadMessages';

interface ActiveRideViewProps {
  ride: RideBooking;
  driverLocation: { lat: number; lng: number } | null;
  onCancelRide: () => void;
}

/** Render the server's ISO-ish timestamps as a local clock time. */
function formatTime(raw: string): string {
  const parsed = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Who a passenger can reach in an emergency, in the order they are most likely
 * to need them.
 *
 * National hotlines first because they work anywhere in the country — the point
 * of putting them here rather than a single city desk is that this app is meant
 * to travel beyond one municipality.
 */
const SOS_CONTACTS = [
  {
    label: 'National Emergency',
    number: '911',
    glyph: '🚨',
    tint: 'bg-rose-100 text-rose-700',
  },
  {
    label: 'Bureau of Fire Protection',
    number: '09637521776',
    glyph: '🚒',
    tint: 'bg-orange-100 text-orange-700',
  },
  {
    label: 'One Rescue',
    number: '09637521776',
    glyph: '🚑',
    tint: 'bg-emerald-100 text-emerald-700',
  },
  {
    label: 'Philippine Red Cross',
    number: '09637521776',
    glyph: '🩸',
    tint: 'bg-red-100 text-red-700',
  },
  {
    label: 'Local Police',
    number: '09637521776',
    glyph: '👮',
    tint: 'bg-blue-100 text-blue-700',
  },
];

export const ActiveRideView: React.FC<ActiveRideViewProps> = ({
  ride,
  onCancelRide,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  /**
   * Keeps the newest message in view.
   *
   * The thread opened scrolled to the top, so a passenger who had just been
   * told they had a reply had to scroll down to find it.
   */
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = chatScrollRef.current;
    if (box && showChat) box.scrollTop = box.scrollHeight;
  }, [messages.length, showChat]);

  const [showTmoModal, setShowTmoModal] = useState(false);
  const [tipAmount, setTipAmount] = useState<number>(0);

  /**
   * How far the rider still is from the pickup, by road.
   *
   * Only meaningful before the passenger is aboard — after that the rider is
   * with them and the trip's own distance is the number that matters. Uses the
   * same route cache the map fills, so this rarely costs a request.
   */
  const [approach, setApproach] = useState<{ km: number; minutes: number } | null>(null);
  const awaitingPickup = ride.status === 'driver_assigned' || ride.status === 'driver_arriving';

  useEffect(() => {
    const rider = ride.assignedDriver;
    if (!awaitingPickup || !rider) {
      setApproach(null);
      return;
    }

    let cancelled = false;
    getStreetRoute([
      { lat: rider.currentLat, lng: rider.currentLng },
      { lat: ride.pickupLocation.lat, lng: ride.pickupLocation.lng },
    ])
      .then((route) => {
        if (cancelled) return;
        setApproach({
          km: Math.round(route.distanceKm * 100) / 100,
          minutes: Math.max(1, route.durationMin),
        });
      })
      .catch(() => {
        if (!cancelled) setApproach(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    awaitingPickup,
    ride.assignedDriver?.currentLat,
    ride.assignedDriver?.currentLng,
    ride.pickupLocation.lat,
    ride.pickupLocation.lng,
  ]);

  // Polled in the background so a rider's message is announced even while the
  // chat panel is closed — otherwise nothing is listening and no badge appears.
  const chatRideIds = React.useMemo(() => (ride.assignedDriver ? [ride.id] : []), [ride.id, ride.assignedDriver]);
  const { unread, markRead } = useUnreadMessages(chatRideIds, 'user');
  const unreadFromRider = unread[ride.id] ?? 0;

  // The driver is typing on another device, so the thread has to be polled.
  const pollMessages = useCallback(async () => {
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
      /* keep the last thread we managed to load */
    }
  }, [ride.id]);

  usePolling(pollMessages, 3000, showChat);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputMsg.trim();
    if (!text) return;

    setInputMsg('');
    // Show it immediately; the next poll replaces it with the server's copy.
    setMessages((prev) => [
      ...prev,
      { id: `pending_${Date.now()}`, sender: 'user', text, time: 'Sending...' },
    ]);

    try {
      await api.sendMessage(ride.id, 'user', text);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'system',
          text: 'Message failed to send. Check your connection.',
          time: '',
        },
      ]);
    }
    void pollMessages();
  };

  const driver = ride.assignedDriver;

  // No rider yet: the emergency and reporting actions have nobody to act on,
  // so they only appear once a rider has accepted.
  const isSearching = ride.status === 'searching_driver';
  const isAccepted = !isSearching;

  // Whole minutes only — a wait counting up in seconds reads as a stopwatch on
  // someone's patience.
  const waitingMinutes =
    typeof ride.searchingSeconds === 'number'
      ? Math.floor(ride.searchingSeconds / 60)
      : null;

  // Where this trip sits in its lifecycle, for the live progress track.
  const STAGES = ['searching_driver', 'driver_assigned', 'driver_arriving', 'in_transit'];
  const stageIndex = Math.max(0, STAGES.indexOf(ride.status));

  const STATUS_LABEL: Record<string, string> = {
    searching_driver: 'Waiting for a rider',
    driver_assigned: 'Rider heading to you',
    driver_arriving: 'Rider arriving at pickup',
    in_transit: 'In transit',
    completed: 'Trip completed',
  };

  /**
   * Minutes that mean something, or nothing at all.
   *
   * Before pickup this is how long the rider takes to reach you; once aboard it
   * is how long until you arrive. Zero is not an answer, so it is suppressed
   * rather than printed as "~0 min".
   */
  const rawEta = approach?.minutes ?? ride.estimatedMinutes;
  const etaMinutes = rawEta && rawEta > 0 ? rawEta : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-3 text-gray-900 flex flex-col gap-3">
      {/* Live status + distance header */}
      <div className="bg-gray-900 text-white p-4 rounded-xl border border-gray-800 flex flex-col gap-3">
        {/* Status gets the row to itself — sharing it with two chips and a
            button truncated it to "RIDER ARRIVING AT PI...". Only SOS stays up
            here, because in an emergency it must be the obvious thing to hit. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
            </span>
            <h3 className="truncate text-xs font-bold uppercase tracking-wider text-amber-400">
              {STATUS_LABEL[ride.status] ?? 'Trip in progress'}
            </h3>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {etaMinutes !== null && (
              <span className="rounded-lg bg-amber-400 px-2.5 py-1.5 text-[11px] font-semibold text-gray-900">
                {etaMinutes} min
              </span>
            )}

            {isAccepted && (
              <button
                onClick={() => setShowSosModal(true)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-xs transition active:scale-95 hover:bg-rose-700"
                title="Emergency"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>SOS</span>
              </button>
            )}
          </div>
        </div>

        {/* Route line */}
        <p className="truncate text-xs font-medium text-gray-300">
          {ride.pickupLocation.name} <span className="text-amber-400">➔</span>{' '}
          {ride.dropoffLocation.name}
        </p>

        {/* Interactive stage progress: fills as the trip advances */}
        <div className="flex items-center gap-1.5">
          {STAGES.map((s, i) => (
            <div key={s} className="flex-1 h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  i < stageIndex
                    ? 'w-full bg-amber-400'
                    : i === stageIndex
                    ? 'w-full bg-amber-400 animate-pulse'
                    : 'w-0'
                }`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Nobody has taken this trip yet.

          A booking used to sit on "Waiting for a rider" indefinitely with no
          hint that it might never be accepted — the worst thing the screen can
          do to someone standing on a kerb. This says so plainly and puts the
          decision back in their hands. It does not cancel anything: a pedicab
          may still be four minutes away, and the passenger is the one who knows
          whether they can keep waiting. */}
      {isSearching && ride.searchStalled && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-2.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-gray-900">
                No rider has accepted yet
                {waitingMinutes !== null && ` — ${waitingMinutes} min waiting`}
              </h4>
              <p className="mt-1 text-[11px] font-medium leading-relaxed text-gray-700">
                Riders nearby may be full or heading the other way. Your request is
                still open and will keep being offered, so you can wait — or cancel
                and try a different pickup point.
              </p>
            </div>
          </div>
          <button
            onClick={onCancelRide}
            className="w-full rounded-xl border-2 border-rose-200 bg-white py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-50 active:scale-95"
          >
            Cancel and rebook
          </button>
        </div>
      )}

      {/* Rider Info Card */}
      {driver && (
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={driver.avatar}
              alt={driver.name}
              className="h-16 w-16 shrink-0 rounded-xl border border-amber-300 object-cover shadow-xs"
            />
            <div className="min-w-0">
              {/* Name and unit share a line — the unit is what a passenger
                  matches against the trike pulling up, so it should be read in
                  the same glance as the name. */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h4 className="truncate text-sm font-bold text-gray-900">{driver.name}</h4>
                <span className="rounded-md bg-gray-900 px-2 py-0.5 text-[11px] font-extrabold tracking-wide text-amber-400">
                  {driver.unitNumber}
                </span>
                {/* Riders register a unit but never a plate, so plate_number is
                    the literal string "TBD" — shown only when it is real. */}
                {driver.plateNumber && driver.plateNumber !== 'TBD' && (
                  <span className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-bold text-gray-700">
                    {driver.plateNumber}
                  </span>
                )}
              </div>

              {/* Shown only when the TMO has actually verified this rider.
                  Claiming "verified" for everyone would make the badge
                  meaningless to the person about to get into their vehicle —
                  and in practice a rider can only be here if verified, since
                  the server blocks anyone else from going online. */}
              {(driver.verificationStatus ?? 'verified') === 'verified' ? (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                  <BadgeCheck className="h-4 w-4 shrink-0" />
                  <span>Verified Dumaguete Rider</span>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Verification {driver.verificationStatus}</span>
                </div>
              )}

              <div className="mt-1 flex items-center gap-2 text-xs font-medium text-gray-600">
                <span className="flex items-center gap-1 font-bold text-gray-800">
                  <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                  {driver.rating}
                </span>
                <span>·</span>
                <span>{driver.tripsCompleted} trips</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Riders sign up without a phone number, so `phone` is often the
                placeholder "—". A tel: link to that dials nothing, which looks
                like the app is broken rather than the number being missing. */}
            {driver.phone && driver.phone !== '—' ? (
              <a
                href={`tel:${driver.phone}`}
                className="rounded-xl bg-gray-900 p-2.5 text-amber-400 shadow-xs transition active:scale-95 hover:bg-black"
                title={`Call ${driver.name}`}
              >
                <Phone className="h-4 w-4" />
              </a>
            ) : (
              <span
                className="cursor-not-allowed rounded-xl bg-gray-200 p-2.5 text-gray-400"
                title="This rider has no contact number on file — use chat instead"
              >
                <Phone className="h-4 w-4" />
              </span>
            )}
            <button
              onClick={() => {
                const opening = !showChat;
                setShowChat(opening);
                if (opening) void markRead(ride.id);
              }}
              className="relative rounded-xl bg-gray-900 p-2.5 text-amber-400 shadow-xs transition active:scale-95 hover:bg-black"
              title="Chat with your rider"
            >
              <MessageSquare className="h-4 w-4" />
              {/* Counts only unread messages from the rider. The old dot showed
                  whenever the thread had any message at all, so it lit up for
                  conversations already read and meant nothing. */}
              {unreadFromRider > 0 && !showChat && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
                  {unreadFromRider}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Chat Window */}
      {showChat && (
        /* Only the message list scrolls. Previously the whole panel did, so the
           header and its close button slid out of reach the moment a
           conversation grew past a few lines. */
        <div className="animate-fadeIn flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-700">
            <span>Chat with {driver?.name ?? 'your rider'}</span>
            <button
              onClick={() => setShowChat(false)}
              className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-200 hover:text-gray-900"
              title="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            ref={chatScrollRef}
            className="gt-scroll flex max-h-56 flex-col gap-2 overflow-y-auto p-3 text-xs"
          >
            {messages.length === 0 && (
              <p className="py-3 text-center text-[11px] font-medium text-gray-500">
                No messages yet — say hello to your rider.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`p-2.5 rounded-xl max-w-[85%] font-medium ${
                  m.sender === 'user'
                    ? 'bg-gray-900 text-amber-400 self-end ml-auto'
                    : m.sender === 'driver'
                    ? 'bg-white border border-gray-200 text-gray-900 self-start shadow-xs'
                    : 'bg-amber-100 text-gray-900 text-[11px] font-bold text-center self-center w-full rounded-lg border border-amber-200'
                }`}
              >
                <p>{m.text}</p>
                <span className="text-[9px] opacity-70 block text-right mt-0.5">{m.time}</span>
              </div>
            ))}
          </div>

          {/* Pinned below the scroll area, so the box to type in is always
              where the passenger left it. */}
          <form
            onSubmit={handleSendMessage}
            className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-gray-50 p-2"
          >
            <input
              type="text"
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              placeholder="Type message..."
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium focus:border-amber-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!inputMsg.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-amber-400 transition active:scale-95 hover:bg-black disabled:bg-gray-200 disabled:text-gray-400"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      {/* Fare Summary & Finish Action */}
      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-gray-500 uppercase tracking-wider">Total Fare</span>
          <span className="text-xl font-extrabold text-gray-900">
            ₱{ride.totalFare + tipAmount}
          </span>
        </div>

        {/* Tip Driver */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
            Tip Rider (Optional):
          </label>
          <div className="flex items-center gap-2">
            {[0, 10, 20, 50].map((amt) => (
              <button
                key={amt}
                onClick={() => setTipAmount(amt)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  tipAmount === amt
                    ? 'bg-gray-900 text-amber-400 shadow-xs'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {amt === 0 ? 'No tip' : `+₱${amt}`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
          <button
            onClick={onCancelRide}
            className={`${
              isAccepted ? 'w-1/2' : 'w-full'
            } py-2.5 border-2 border-rose-200 hover:bg-rose-50 text-rose-700 font-bold text-xs rounded-xl transition`}
          >
            Cancel Trip
          </button>
          {isAccepted && (
            <button
              onClick={() => setShowTmoModal(true)}
              className="w-1/2 py-2.5 bg-amber-400 hover:bg-amber-300 text-gray-900 font-extrabold text-xs rounded-xl shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>File Report</span>
            </button>
          )}
        </div>
      </div>

      {/* Dumaguete TMO Complaint Modal */}
      <TmoReportModal
        isOpen={showTmoModal}
        onClose={() => setShowTmoModal(false)}
        ride={ride}
      />

      {/* Emergency SOS.
          Every number here dials. `tel:` hands off to the phone's dialler, so
          these work on a handset and do nothing useful on a desktop browser —
          which is the correct behaviour for a button meant to be pressed in a
          moving trike. */}
      {showSosModal && (
        <Portal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/70 p-4 backdrop-blur-sm">
          <div className="animate-scaleUp flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-rose-600 px-5 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
                  <ShieldAlert className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-base font-bold leading-tight">Emergency</p>
                  <p className="text-[11px] text-white/70">Tap to call — the line opens immediately</p>
                </div>
              </div>
              <button
                onClick={() => setShowSosModal(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="gt-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {SOS_CONTACTS.map((contact) => (
                <a
                  key={contact.label}
                  href={`tel:${contact.number.replace(/\s/g, '')}`}
                  className="flex items-center gap-3 rounded-2xl border border-gray-200 p-3.5 transition-all hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-50 hover:shadow-md active:scale-[0.99]"
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${contact.tint}`}
                  >
                    {contact.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900">
                      {contact.label}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {contact.number}
                    </span>
                  </span>
                  <Phone className="h-4 w-4 shrink-0 text-rose-500" />
                </a>
              ))}
            </div>

            {/* The trip itself is the most useful thing to read out to whoever
                answers, so it is on screen while the call is being made. */}
            <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Your trip
              </p>
              <p className="mt-1 truncate text-xs font-semibold text-gray-900">
                {ride.pickupLocation.name} → {ride.dropoffLocation.name}
              </p>
              {driver && (
                <p className="mt-0.5 truncate text-[11px] text-gray-500">
                  {driver.name} · {driver.unitNumber}
                </p>
              )}
            </div>

            <button
              onClick={() => setShowSosModal(false)}
              className="shrink-0 border-t border-gray-100 py-3 text-xs font-semibold text-gray-500 transition hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
};
