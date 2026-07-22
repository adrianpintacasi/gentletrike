import React, { useState } from 'react';
import { RideBooking } from '../types';
import { Star, X, CheckCircle, FileText } from 'lucide-react';
import { TmoReportModal } from './TmoReportModal';
import * as api from '../api';

interface RideCompleteModalProps {
  ride: RideBooking;
  /** Dismissing returns the passenger to an empty booking screen. */
  onClose: () => void;
}

/**
 * Shown once the rider marks the trip finished. The rider's details stay on
 * screen instead of vanishing, so the passenger can still recognise who drove
 * them. Rating and reporting are both optional — closing is always allowed.
 */
export const RideCompleteModal: React.FC<RideCompleteModalProps> = ({ ride, onClose }) => {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  const driver = ride.assignedDriver;
  const shown = hovered || stars;

  const handleSubmit = async () => {
    if (stars < 1 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.rateRide(ride.id, stars);
      setSaved(true);
      // Give the confirmation a moment to register, then clear the screen.
      setTimeout(onClose, 900);
    } catch (err) {
      setError(
        err instanceof api.ApiError ? err.message : 'Could not save your rating.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
        <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 text-gray-900 flex flex-col overflow-hidden animate-scaleUp">
          {/* Header */}
          <div className="bg-gray-900 text-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <h3 className="font-bold text-sm leading-tight">Trip completed</h3>
                <p className="text-[11px] text-gray-400 font-medium">
                  Daghang salamat sa pagsakay!
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-800 rounded-full transition text-gray-400 hover:text-white"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Rider details stay visible */}
            {driver && (
              <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200 flex items-center gap-3">
                <img
                  src={driver.avatar}
                  alt={driver.name}
                  className="w-12 h-12 rounded-xl object-cover border border-amber-300 shrink-0"
                />
                <div className="min-w-0">
                  <h4 className="font-bold text-sm truncate">{driver.name}</h4>
                  <p className="text-[11px] text-gray-600 font-medium truncate">
                    {driver.unitNumber} • Plate {driver.plateNumber}
                  </p>
                </div>
                <span className="ml-auto text-lg font-extrabold shrink-0">
                  ₱{ride.totalFare}
                </span>
              </div>
            )}

            <p className="text-[11px] text-gray-500 font-medium text-center">
              {ride.pickupLocation.name} ➔ {ride.dropoffLocation.name} • {ride.distanceKm} km
            </p>

            {/* Star rating */}
            <div className="text-center space-y-2">
              <p className="text-xs font-bold text-gray-700">
                How was your ride? <span className="font-medium text-gray-400">(optional)</span>
              </p>
              <div className="flex items-center justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setStars(n)}
                    onMouseEnter={() => setHovered(n)}
                    onMouseLeave={() => setHovered(0)}
                    disabled={saved}
                    className="p-1 transition active:scale-90 disabled:cursor-default"
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    <Star
                      className={`w-8 h-8 transition ${
                        n <= shown
                          ? 'fill-amber-400 text-amber-400'
                          : 'fill-gray-100 text-gray-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
              {saved && (
                <p className="text-xs font-bold text-emerald-700">
                  Salamat! Your rating was recorded.
                </p>
              )}
              {error && <p className="text-xs font-bold text-rose-700">{error}</p>}
            </div>

            {/* Actions — every one of these is optional */}
            <div className="space-y-2 pt-1">
              <button
                onClick={handleSubmit}
                disabled={stars < 1 || saving || saved}
                className="w-full py-3 rounded-xl font-bold text-xs bg-amber-400 hover:bg-amber-300 disabled:bg-gray-200 disabled:text-gray-400 text-gray-900 shadow-sm transition active:scale-95"
              >
                {saving ? 'Saving…' : saved ? 'Rating submitted' : 'Submit rating'}
              </button>

              <button
                onClick={() => setShowReport(true)}
                className="w-full py-2.5 rounded-xl font-bold text-xs bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 transition flex items-center justify-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>File a report to Dumaguete TMO</span>
              </button>

              <button
                onClick={onClose}
                className="w-full py-2 text-xs font-bold text-gray-500 hover:text-gray-900 transition"
              >
                {saved ? 'Done' : 'Skip and close'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <TmoReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        ride={ride}
      />
    </>
  );
};
