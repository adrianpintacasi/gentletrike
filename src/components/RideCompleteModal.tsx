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
/** What each score means, so the stars are not five silent shapes. */
const RATING_WORDS = ['Poor', 'Not great', 'Fine', 'Good', 'Excellent'];

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
      <div className="animate-fadeIn fixed inset-0 z-[100] flex items-center justify-center bg-trust-slate/80 p-4 backdrop-blur-sm">
        <div className="bg-cream-50 rounded-[28px] max-w-md w-full shadow-2xl border border-cream-300 text-trust-slate flex flex-col overflow-hidden animate-scaleUp">
          {/* Header */}
          <div className="bg-trust-slate text-cream-50 p-4 flex items-center justify-between border-b border-cream-400/20">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-5 h-5 text-sampaguita-green shrink-0" />
              <div>
                <h3 className="font-display font-bold text-sm leading-tight text-cream-50">Trip completed</h3>
                <p className="text-[11px] text-cream-300 font-sans font-medium">
                  Daghang salamat sa pagsakay!
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 rounded-full transition text-cream-300 hover:text-cream-50"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Rider details stay visible */}
            {driver && (
              <div className="bg-cream-100 p-3.5 rounded-card border border-cream-300 flex items-center gap-3">
                <img
                  src={driver.avatar}
                  alt={driver.name}
                  className="w-12 h-12 rounded-card object-cover border border-cream-300 shrink-0"
                />
                <div className="min-w-0">
                  <h4 className="font-display font-bold text-sm text-trust-slate truncate">{driver.name}</h4>
                  <p className="text-[11px] text-cream-600 font-sans font-medium truncate">
                    {driver.unitNumber}
                  </p>
                </div>
                <span className="ml-auto text-lg font-display font-extrabold text-trust-slate shrink-0">
                  ₱{ride.totalFare}
                </span>
              </div>
            )}

            <p className="text-[11px] text-cream-600 font-sans font-medium text-center">
              {ride.pickupLocation.name} ➔ {ride.dropoffLocation.name} • {ride.distanceKm} km
            </p>

            {/* Star rating */}
            <div className="gt-star-row space-y-2 text-center">
              <svg width="0" height="0" aria-hidden className="absolute">
                <defs>
                  <linearGradient id="gt-star-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--color-trike-gold)" />
                    <stop offset="100%" stopColor="var(--color-trike-gold-hover)" />
                  </linearGradient>
                </defs>
              </svg>

              <p className="text-sm font-display font-bold text-trust-slate">How was your ride?</p>

              <div className="flex items-center justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setStars(n)}
                    onMouseEnter={() => setHovered(n)}
                    onMouseLeave={() => setHovered(0)}
                    disabled={saved}
                    className={`p-1.5 transition-transform active:scale-90 disabled:cursor-default ${
                      n <= shown ? 'gt-star-lit' : 'gt-star-dim'
                    }`}
                    style={{ animationDelay: `${(n - 1) * 40}ms` }}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    <Star className="h-9 w-9 text-trike-gold" />
                  </button>
                ))}
              </div>

              <p className="h-4 text-[11px] font-sans font-medium text-cream-600">
                {shown > 0 ? RATING_WORDS[shown - 1] : 'Tap to rate — optional'}
              </p>
              {saved && (
                <p className="text-xs font-sans font-semibold text-sampaguita-green">
                  Salamat! Your rating was recorded.
                </p>
              )}
              {error && <p className="text-xs font-sans font-semibold text-sunset-coral">{error}</p>}
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-1">
              <button
                onClick={handleSubmit}
                disabled={stars < 1 || saving || saved}
                className="btn-primary w-full py-3 text-xs font-display font-bold shadow-sm disabled:opacity-40"
              >
                {saving ? 'Saving…' : saved ? 'Rating submitted' : 'Submit rating'}
              </button>

              <button
                onClick={() => setShowReport(true)}
                className="w-full py-2.5 rounded-pill font-display font-bold text-xs bg-cream-50 border border-sunset-coral/40 text-sunset-coral hover:bg-sunset-coral/10 transition flex items-center justify-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>File a report to Dumaguete TMO</span>
              </button>

              <button
                onClick={onClose}
                className="w-full py-2 text-xs font-display font-bold text-cream-600 hover:text-trust-slate transition"
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
