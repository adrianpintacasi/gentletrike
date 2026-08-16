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
  onAdjustPickup?: () => void;
}

/** Render the server's ISO-ish timestamps as a local clock time. */
function formatTime(raw: string): string {
  const parsed = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Emergency SOS contacts in Dumaguete.
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
    label: 'One Rescue Dumaguete',
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
    label: 'Dumaguete Police (PNP)',
    number: '09637521776',
    glyph: '👮',
    tint: 'bg-blue-100 text-blue-700',
  },
];

export const ActiveRideView: React.FC<ActiveRideViewProps> = ({
  ride,
  onCancelRide,
  onAdjustPickup,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = chatScrollRef.current;
    if (box && showChat) box.scrollTop = box.scrollHeight;
  }, [messages.length, showChat]);

  const [showTmoModal, setShowTmoModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Neutral tip by default: no chip is selected until user chooses one
  const [selectedTip, setSelectedTip] = useState<number | null>(null);
  const tipAmount = selectedTip ?? 0;

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
  const STAGES = [
    { key: 'searching_driver', label: 'Requested' },
    { key: 'driver_assigned', label: 'Assigned' },
    { key: 'driver_arriving', label: 'On the way' },
    { key: 'in_transit', label: 'Arrived' },
  ];
  const stageIndex = Math.max(0, STAGES.findIndex((s) => s.key === ride.status));

  const STATUS_LABEL: Record<string, string> = {
    searching_driver:
      waitingMinutes !== null && waitingMinutes >= 3
        ? 'Still finding a nearby driver...'
        : 'Finding your driver...',
    driver_assigned: 'Driver is on the way',
    driver_arriving: 'Driver arriving at pickup',
    in_transit: 'On your way to destination',
    completed: 'Trip completed',
  };

  /**
   * Minutes that mean something, or nothing at all.
   */
  const rawEta = approach?.minutes ?? ride.estimatedMinutes;
  const etaMinutes = rawEta && rawEta > 0 ? rawEta : null;

  return (
    <div className="bg-cream-50 rounded-card border border-cream-300 shadow-xs p-3.5 text-trust-slate flex flex-col gap-3">
      {/* Live status + reassuring sentence-case header */}
      <div className="bg-trust-slate text-cream-50 p-4 rounded-card border border-cream-400/20 flex flex-col gap-3 shadow-md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="status-pulse h-2.5 w-2.5 shrink-0" />
            <h3 className="truncate text-base font-display font-black text-cream-50">
              {STATUS_LABEL[ride.status] ?? 'Trip in progress'}
            </h3>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {etaMinutes !== null && (
              <span className="rounded-pill bg-trike-gold text-trust-slate font-display font-black text-xs px-3 py-1 shadow-xs">
                Arrives in ~{etaMinutes} min{etaMinutes > 1 ? 's' : ''}
              </span>
            )}

            {isAccepted && (
              <button
                onClick={() => setShowSosModal(true)}
                className="flex shrink-0 items-center gap-1 rounded-pill bg-sunset-coral px-3.5 py-1 text-xs font-sans font-bold text-white shadow-xs transition active:scale-95 hover:bg-sunset-coral/90"
                title="Emergency SOS"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>SOS</span>
              </button>
            )}
          </div>
        </div>

        {/* Route Line */}
        <p className="truncate text-[13px] font-sans font-medium text-cream-200">
          {ride.pickupLocation.name} <span className="text-trike-gold font-bold">➔</span>{' '}
          {ride.dropoffLocation.name}
        </p>

        {/* Labeled Progress Bar in 4-column Grid */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex flex-col items-center gap-1.5 min-w-0">
              <div className="w-full h-2 rounded-full bg-white/20 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    i < stageIndex
                      ? 'w-full bg-sampaguita-green'
                      : i === stageIndex
                      ? 'w-full bg-trike-gold animate-pulse'
                      : 'w-0'
                  }`}
                />
              </div>
              <span
                className={`text-[11px] sm:text-xs font-sans font-bold text-center truncate w-full ${
                  i <= stageIndex ? 'text-cream-50' : 'text-cream-300/70'
                }`}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Single Escalated Search Assistance Block (Only when wait > 3 min or search stalled) */}
      {isSearching && (waitingMinutes !== null && waitingMinutes >= 3 || ride.searchStalled) && (
        <div className="rounded-card border border-amber-300 bg-amber-50/70 p-3.5 flex flex-col gap-2.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0 text-xs">
              <h4 className="font-display font-bold text-trust-slate">
                Search taking longer than usual
                {waitingMinutes !== null && ` (~${waitingMinutes} min)`}
              </h4>
              <p className="mt-1 text-[11px] font-sans text-cream-700 leading-relaxed">
                Drivers in Dumaguete may currently have full seats along their route. Your request remains active across all units.
              </p>
            </div>
          </div>
          {onAdjustPickup && (
            <button
              onClick={onAdjustPickup}
              className="w-full py-2 rounded-pill bg-cream-50 border border-cream-300 text-trust-slate text-xs font-display font-bold hover:bg-cream-200 transition active:scale-95 shadow-2xs"
            >
              Adjust pickup location
            </button>
          )}
        </div>
      )}

      {/* Driver & Vehicle Trust Card */}
      {driver && (
        <div className="bg-cream-50 p-4 rounded-card border border-cream-300 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative">
              {driver.avatar ? (
                <img
                  src={driver.avatar}
                  alt={driver.name}
                  className="h-14 w-14 shrink-0 rounded-full border-2 border-trike-gold object-cover shadow-xs"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-trust-slate text-trike-gold font-display font-black text-lg shadow-xs border-2 border-trike-gold">
                  {driver.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h4 className="truncate text-base font-display font-black text-trust-slate">{driver.name}</h4>
                <span className="rounded-pill bg-trust-slate px-2.5 py-0.5 text-xs font-display font-extrabold tracking-wide text-trike-gold">
                  Unit #{driver.unitNumber || '104'}
                </span>
                {driver.plateNumber && driver.plateNumber !== 'TBD' && (
                  <span className="rounded-pill border border-cream-300 bg-cream-100 px-2 py-0.5 text-[11px] font-sans font-bold text-cream-700">
                    {driver.plateNumber}
                  </span>
                )}
              </div>

              <div className="mt-1 flex items-center gap-1.5 text-xs font-sans font-bold text-sampaguita-green">
                <BadgeCheck className="h-4 w-4 shrink-0" />
                <span>Verified Dumaguete Franchise</span>
              </div>

              <div className="mt-0.5 flex items-center gap-2 text-xs font-sans font-medium text-cream-700">
                <span className="flex items-center gap-1 font-bold text-trust-slate">
                  <Star className="h-3.5 w-3.5 fill-trike-gold text-trike-gold" />
                  {driver.rating || '4.9'}
                </span>
                <span>·</span>
                <span>{driver.tripsCompleted || '120'} trips completed</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {driver.phone && driver.phone !== '—' ? (
              <a
                href={`tel:${driver.phone}`}
                className="btn-icon-secondary flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cream-300 bg-cream-100 text-trust-slate hover:bg-cream-200"
                title={`Call ${driver.name}`}
              >
                <Phone className="h-4 w-4" />
              </a>
            ) : (
              <span
                className="cursor-not-allowed rounded-full bg-cream-200 p-2.5 text-cream-400"
                title="This driver has no phone on file — use chat instead"
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
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cream-300 bg-cream-100 text-trust-slate hover:bg-cream-200 transition active:scale-95"
              title="Chat with your driver"
            >
              <MessageSquare className="h-4 w-4" />
              {unreadFromRider > 0 && !showChat && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sunset-coral px-1 text-[9px] font-black text-white">
                  {unreadFromRider}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Chat Window */}
      {showChat && (
        <div className="animate-fadeIn flex flex-col overflow-hidden rounded-card border border-cream-300 bg-cream-100">
          <div className="flex shrink-0 items-center justify-between border-b border-cream-300 bg-cream-100 px-3 py-2 text-xs font-display font-bold text-trust-slate">
            <span>Chat with {driver?.name ?? 'your driver'}</span>
            <button
              onClick={() => setShowChat(false)}
              className="rounded-full p-1 text-cream-600 transition hover:bg-cream-200 hover:text-trust-slate"
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
              <p className="py-3 text-center text-[11px] font-sans font-medium text-cream-600">
                No messages yet — say hello to your driver.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`p-2.5 rounded-card max-w-[85%] font-medium ${
                  m.sender === 'user'
                    ? 'bg-trust-slate text-cream-50 self-end ml-auto'
                    : m.sender === 'driver'
                    ? 'bg-cream-50 border border-cream-300 text-trust-slate self-start shadow-xs'
                    : 'bg-trike-gold/20 text-trust-slate text-[11px] font-display font-bold text-center self-center w-full rounded-card border border-trike-gold/40'
                }`}
              >
                <p>{m.text}</p>
                <span className="text-[9px] opacity-70 block text-right mt-0.5">{m.time}</span>
              </div>
            ))}
          </div>

          <form
            onSubmit={handleSendMessage}
            className="flex shrink-0 items-center gap-2 border-t border-cream-300 bg-cream-100 p-2"
          >
            <input
              type="text"
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              placeholder="Type message to driver..."
              className="min-w-0 flex-1 rounded-card border border-cream-300 bg-cream-50 px-3 py-2 text-xs font-sans font-medium text-trust-slate focus:border-trike-gold focus:outline-none"
            />
            <button
              type="submit"
              disabled={!inputMsg.trim()}
              className="btn-primary flex h-9 w-9 shrink-0 items-center justify-center shadow-xs disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      {/* Transparent Fare Summary & Neutral Tip Card */}
      <div className="bg-cream-50 p-4 rounded-card border border-cream-300 flex flex-col gap-3 shadow-xs">
        <div>
          <div className="flex items-center justify-between">
            <span className="kicker-label text-xs font-display font-bold text-cream-700">TOTAL FARE</span>
            <span className="text-2xl font-display font-black text-trust-slate tracking-tight">
              ₱{(ride.totalFare + tipAmount).toFixed(2)}
            </span>
          </div>
          <p className="text-xs font-sans font-medium text-cream-700 mt-1 leading-relaxed">
            Base fare: ₱15.00 + ₱{Math.max(0, ride.totalFare - 15).toFixed(2)} ({(ride.distanceKm || 2.0).toFixed(1)} km · Standard Ordinance)
          </p>
        </div>

        {/* Tip Driver (Optional) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="kicker-label text-xs font-display font-bold text-cream-700">
              Tip driver (optional)
            </label>
            {selectedTip !== null && selectedTip > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTip(null)}
                className="text-xs font-sans font-bold text-cream-600 hover:text-sunset-coral transition"
              >
                Clear tip
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {[
              { label: '+₱5', amt: 5 },
              { label: '+₱10', amt: 10 },
              { label: '+₱20', amt: 20 },
              { label: '+₱50', amt: 50 },
            ].map(({ label, amt }) => {
              const isSelected = selectedTip !== null && selectedTip === amt;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedTip((prev) => (prev === amt ? null : amt))}
                  className={`flex-1 py-2 sm:py-2.5 rounded-pill text-sm font-display font-bold transition active:scale-95 ${
                    isSelected
                      ? 'bg-trust-slate text-cream-50 shadow-xs border border-trust-slate'
                      : 'bg-cream-50 border border-cream-300 text-trust-slate hover:bg-cream-100 hover:border-cream-400'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Row */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-cream-200">
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="text-sm font-display font-bold text-sunset-coral hover:underline py-1"
          >
            Cancel ride
          </button>

          {isAccepted && (
            <button
              onClick={() => setShowTmoModal(true)}
              className="flex items-center gap-1.5 text-xs font-display font-bold text-cream-700 bg-cream-100 hover:bg-cream-200 border border-cream-300 px-3.5 py-1.5 rounded-pill transition active:scale-95"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-trike-gold" />
              <span>Report Issue</span>
            </button>
          )}
        </div>
      </div>

      {/* Cancel Ride Confirmation Modal */}
      {showCancelConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-trust-slate/80 p-4 backdrop-blur-xs">
            <div className="animate-scaleUp flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-card bg-cream-50 shadow-2xl border border-cream-300 p-5">
              <div className="flex items-center gap-3 text-sunset-coral mb-2">
                <AlertTriangle className="h-6 w-6 shrink-0" />
                <h3 className="font-display font-extrabold text-base text-trust-slate">
                  Cancel this trip?
                </h3>
              </div>
              <p className="text-xs font-sans text-cream-700 leading-relaxed mb-4">
                {driver
                  ? `Your driver ${driver.name} is currently en route to your pickup point. Cancelling may disrupt their route.`
                  : 'Are you sure you want to cancel your ride request?'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="btn-primary flex-1 py-2.5 text-xs font-display font-bold"
                >
                  Keep my ride
                </button>
                <button
                  onClick={() => {
                    setShowCancelConfirm(false);
                    onCancelRide();
                  }}
                  className="flex-1 py-2.5 rounded-pill border border-sunset-coral bg-sunset-coral/10 text-sunset-coral hover:bg-sunset-coral/20 font-display font-bold text-xs transition"
                >
                  Yes, cancel
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Dumaguete TMO Complaint Modal */}
      <TmoReportModal
        isOpen={showTmoModal}
        onClose={() => setShowTmoModal(false)}
        ride={ride}
      />

      {/* Emergency SOS */}
      {showSosModal && (
        <Portal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-trust-slate/80 p-4 backdrop-blur-sm">
          <div className="animate-scaleUp flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-[28px] bg-cream-50 shadow-2xl border border-cream-300">
            <div className="flex shrink-0 items-center justify-between bg-sunset-coral px-5 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-card bg-white/20">
                  <ShieldAlert className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-base font-display font-bold leading-tight">Emergency</p>
                  <p className="text-[11px] font-sans text-white/80">Tap to call — the line opens immediately</p>
                </div>
              </div>
              <button
                onClick={() => setShowSosModal(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="gt-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {SOS_CONTACTS.map((contact) => (
                <a
                  key={contact.label}
                  href={`tel:${contact.number.replace(/\s/g, '')}`}
                  className="flex items-center gap-3 rounded-card border border-cream-300 bg-cream-50 p-3.5 transition-all hover:-translate-y-0.5 hover:border-sunset-coral hover:bg-sunset-coral/10 hover:shadow-md active:scale-[0.99]"
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-card text-lg ${contact.tint}`}
                  >
                    {contact.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-display font-semibold text-trust-slate">
                      {contact.label}
                    </span>
                    <span className="block truncate text-[11px] font-sans text-cream-600">
                      {contact.number}
                    </span>
                  </span>
                  <Phone className="h-4 w-4 shrink-0 text-sunset-coral" />
                </a>
              ))}
            </div>

            <div className="shrink-0 border-t border-cream-300 bg-cream-100 px-4 py-3">
              <p className="kicker-label">
                Your trip
              </p>
              <p className="mt-1 truncate text-xs font-display font-bold text-trust-slate">
                {ride.pickupLocation.name} → {ride.dropoffLocation.name}
              </p>
              {driver && (
                <p className="mt-0.5 truncate text-[11px] font-sans text-cream-600">
                  {driver.name} · {driver.unitNumber}
                </p>
              )}
            </div>

            <button
              onClick={() => setShowSosModal(false)}
              className="shrink-0 border-t border-cream-300 py-3 text-xs font-display font-bold text-cream-600 transition hover:bg-cream-200 hover:text-trust-slate"
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
