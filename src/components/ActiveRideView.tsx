import React, { useCallback, useState } from 'react';
import { ChatMessage, RideBooking } from '../types';
import { Phone, MessageSquare, ShieldAlert, Star, Send, X, AlertTriangle } from 'lucide-react';
import { TmoReportModal } from './TmoReportModal';
import * as api from '../api';
import { usePolling } from '../hooks/usePolling';

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

export const ActiveRideView: React.FC<ActiveRideViewProps> = ({
  ride,
  onCancelRide,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const [showTmoModal, setShowTmoModal] = useState(false);
  const [tipAmount, setTipAmount] = useState<number>(0);

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

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-md p-5 md:p-6 text-gray-900 flex flex-col gap-4">
      {/* Header Bar */}
      <div className="bg-gray-900 text-white p-4 rounded-xl border border-gray-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-3 h-3 rounded-full bg-amber-400 animate-ping shrink-0" />
          <div className="min-w-0">
            <h3 className="font-bold text-xs text-amber-400 uppercase tracking-wider truncate">
              {ride.status === 'searching_driver' && 'Waiting for a rider to accept...'}
              {ride.status === 'driver_assigned' && 'Rider Assigned • Heading to you'}
              {ride.status === 'driver_arriving' && 'Rider Arriving at Pickup'}
              {ride.status === 'in_transit' && 'In Transit • GPS Tracking Active'}
              {ride.status === 'completed' && 'Trip Completed!'}
            </h3>
            <p className="text-xs text-gray-300 font-medium truncate">
              {ride.pickupLocation.name} ➔ {ride.dropoffLocation.name} ({ride.distanceKm} km)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowTmoModal(true)}
            className="bg-amber-400 hover:bg-amber-300 text-gray-900 px-3 py-1.5 rounded-lg text-xs font-extrabold shadow-xs transition active:scale-95 flex items-center gap-1"
            title="File complaint to Dumaguete TMO"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-gray-900" />
            <span className="hidden sm:inline">File TMO Report</span>
            <span className="sm:hidden">Report</span>
          </button>

          <button
            onClick={() => setShowSosModal(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold shadow-xs transition active:scale-95 flex items-center gap-1"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>SOS</span>
          </button>
        </div>
      </div>

      {/* Rider Info Card */}
      {driver && (
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={driver.avatar}
              alt={driver.name}
              className="w-12 h-12 rounded-xl object-cover border border-amber-300 shadow-xs shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h4 className="font-bold text-sm text-gray-900 truncate">{driver.name}</h4>
                <span className="text-[10px] bg-gray-900 text-amber-400 font-bold px-2 py-0.5 rounded-md shrink-0">
                  {driver.unitNumber}
                </span>
              </div>
              <p className="text-xs text-gray-600 font-medium truncate">
                Plate: {driver.plateNumber} • {driver.tripsCompleted} trips
              </p>
              <div className="flex items-center gap-1 text-xs font-bold text-gray-800 mt-0.5">
                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                <span>{driver.rating} Rating</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`tel:${driver.phone}`}
              className="p-2.5 bg-gray-900 text-amber-400 rounded-xl hover:bg-black transition active:scale-95 shadow-xs"
              title="Call Rider"
            >
              <Phone className="w-4 h-4" />
            </a>
            <button
              onClick={() => setShowChat(!showChat)}
              className="p-2.5 bg-gray-900 text-amber-400 rounded-xl hover:bg-black transition active:scale-95 shadow-xs relative"
              title="Chat Rider"
            >
              <MessageSquare className="w-4 h-4" />
              {messages.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Chat Window */}
      {showChat && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2 max-h-56 overflow-y-auto animate-fadeIn">
          <div className="flex items-center justify-between border-b pb-1 text-xs font-bold text-gray-700">
            <span>In-App Chat with Rider:</span>
            <button
              onClick={() => setShowChat(false)}
              className="text-gray-400 hover:text-gray-900 text-xs"
            >
              Close
            </button>
          </div>
          <div className="flex flex-col gap-2 text-xs">
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

          <form onSubmit={handleSendMessage} className="flex items-center gap-2 mt-1">
            <input
              type="text"
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              placeholder="Type message..."
              className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-amber-400"
            />
            <button
              type="submit"
              className="p-1.5 bg-gray-900 text-amber-400 rounded-lg hover:bg-black transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* Fare Summary & Finish Action */}
      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs font-bold">
          <div>
            <span className="text-gray-500 uppercase tracking-wider block">Auto-Calculated Fare:</span>
            <span className="text-[10px] text-gray-500 font-normal">Distance: {ride.distanceKm} km</span>
          </div>
          <span className="text-xl font-extrabold text-gray-900">
            ₱{ride.totalFare + tipAmount}
          </span>
        </div>

        {/* TMO Enforcement Advisory */}
        <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span className="text-[11px] font-medium text-amber-900">
              Asked higher fare or harassed? Report rider directly to TMO.
            </span>
          </div>
          <button
            onClick={() => setShowTmoModal(true)}
            className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-gray-900 font-extrabold text-[11px] rounded-lg shadow-xs transition shrink-0"
          >
            File Report
          </button>
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

        <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
          <button
            onClick={onCancelRide}
            className="w-1/3 py-2.5 border border-gray-200 hover:bg-gray-100 text-gray-800 font-bold text-xs rounded-xl transition"
          >
            Cancel Trip
          </button>
          <div className="w-2/3 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="truncate">Rider completes trip upon drop-off</span>
          </div>
        </div>
      </div>

      {/* Dumaguete TMO Complaint Modal */}
      <TmoReportModal
        isOpen={showTmoModal}
        onClose={() => setShowTmoModal(false)}
        ride={ride}
      />

      {/* Emergency SOS Modal */}
      {showSosModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-rose-200 flex flex-col gap-4 text-gray-900 animate-scaleUp">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2 text-rose-600 font-bold text-base">
                <ShieldAlert className="w-5 h-5" />
                <span>Dumaguete Emergency SOS</span>
              </div>
              <button onClick={() => setShowSosModal(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <p className="text-xs text-gray-600 font-medium">
              Need assistance? Connect directly with official Dumaguete City emergency responders.
            </p>

            <div className="flex flex-col gap-2">
              <a
                href="tel:911"
                className="w-full bg-rose-600 text-white font-bold py-2.5 rounded-xl text-center shadow-xs hover:bg-rose-700 transition text-xs"
              >
                🚨 Call National Emergency (911)
              </a>
              <a
                href="tel:166"
                className="w-full bg-gray-900 text-amber-400 font-bold py-2 rounded-xl text-center hover:bg-black transition text-xs"
              >
                📞 Dumaguete City Police (166)
              </a>
            </div>

            <button
              onClick={() => setShowSosModal(false)}
              className="w-full text-gray-500 text-xs text-center font-bold hover:underline"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
