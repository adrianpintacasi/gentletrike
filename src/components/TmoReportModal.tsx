import React, { useState } from 'react';
import { RideBooking } from '../types';
import { ShieldAlert, X, AlertTriangle, CheckCircle, Phone, FileText } from 'lucide-react';
import * as api from '../api';
import { Portal } from './Portal';
import { VEHICLE_DETAILS } from '../../shared/transport';

interface TmoReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  ride: RideBooking;
}

type ViolationKey =
  | 'overcharging'
  | 'harassment'
  | 'refusal'
  | 'reckless'
  | 'unsafe_vehicle'
  | 'other';

/**
 * What a passenger can report.
 *
 * Short labels in a grid rather than full-width cards each carrying a sentence:
 * someone filing a complaint has already decided what happened, so the
 * descriptions sat between them and the form.
 *
 * "Something else" matters more than it looks. Without it, anything the list
 * fails to name goes unreported, and the office never learns that the category
 * was missing in the first place.
 */
const VIOLATIONS: { key: ViolationKey; label: string; glyph: string }[] = [
  { key: 'overcharging', label: 'Asked higher fare', glyph: '₱' },
  { key: 'harassment', label: 'Harassment', glyph: '⚠️' },
  { key: 'refusal', label: 'Refused the trip', glyph: '🚫' },
  { key: 'reckless', label: 'Reckless driving', glyph: '🏍️' },
  { key: 'unsafe_vehicle', label: 'Unsafe vehicle', glyph: '🔧' },
  { key: 'other', label: 'Something else', glyph: '❓' },
];

export const TmoReportModal: React.FC<TmoReportModalProps> = ({ isOpen, onClose, ride }) => {
  const [violationType, setViolationType] = useState<ViolationKey>('overcharging');
  const [demandedFare, setDemandedFare] = useState<string>('');
  const [incidentDetails, setIncidentDetails] = useState<string>('');
  // Empty, not a sample. A prefilled number gets submitted unchanged and the
  // office ends up calling a stranger about someone else's trip.
  const [contactNumber, setContactNumber] = useState<string>('');
  const [submittedReference, setSubmittedReference] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  const driver = ride.assignedDriver;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // The reference code comes from the server, so the complaint is on file
      // rather than being a number generated and forgotten in the browser.
      const referenceCode = await api.submitTmoReport({
        rideId: ride.id,
        driverId: driver?.id,
        violationType,
        demandedFare: demandedFare ? Number(demandedFare) : undefined,
        details: incidentDetails,
        contactNumber,
      });
      setSubmittedReference(referenceCode);
    } catch (err) {
      setSubmitError(
        err instanceof api.ApiError
          ? err.message
          : 'Could not file the report. Check your connection and try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetAndClose = () => {
    setSubmittedReference(null);
    setSubmitError(null);
    setIncidentDetails('');
    setDemandedFare('');
    onClose();
  };

  return (
    <Portal>
    <div className="animate-fadeIn fixed inset-0 z-[100] flex items-center justify-center bg-trust-slate/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-[28px] bg-cream-50 text-trust-slate shadow-2xl border border-cream-300">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between bg-sunset-coral px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-card bg-white/20">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-display font-bold text-base leading-tight">Complaint Portal</h3>
              <p className="text-[11px] font-sans text-white/80">Filed with your local transport office</p>
            </div>
          </div>

          <button
            onClick={handleResetAndClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submittedReference ? (
          /* Confirmation View */
          <div className="gt-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-center">
            <div className="w-16 h-16 bg-sampaguita-green/20 text-sampaguita-green rounded-full flex items-center justify-center mx-auto border-2 border-sampaguita-green/40 shadow-sm">
              <CheckCircle className="w-9 h-9" />
            </div>

            <div>
              <span className="text-xs font-display font-bold uppercase tracking-widest text-sampaguita-green bg-sampaguita-green/10 px-3 py-1 rounded-pill border border-sampaguita-green/30 inline-block mb-2">
                Complaint Successfully Logged
              </span>
              <h4 className="text-xl font-display font-extrabold text-trust-slate">Reference: {submittedReference}</h4>
              <p className="text-xs font-sans text-cream-700 mt-2 font-medium max-w-md mx-auto">
                Your report against Motorcab <strong className="text-trust-slate">{driver?.unitNumber || 'Unit'}</strong> has been submitted to your local transport office.
              </p>
            </div>

            <div className="bg-cream-100 p-4 rounded-card border border-cream-300 text-left text-xs space-y-2">
              <div className="flex items-center gap-2 font-display font-bold text-trust-slate">
                <AlertTriangle className="w-4 h-4 text-trike-gold shrink-0" />
                <span>Summary of Flagged Incident:</span>
              </div>
              <p className="text-cream-700 font-sans">
                • <strong>Category:</strong> {violationType.toUpperCase()}
              </p>
              {demandedFare && (
                <p className="text-cream-700 font-sans">
                  • <strong>Overcharge Claim:</strong> Demanded ₱{demandedFare} vs. Auto-Calculated ₱{ride.totalFare}
                </p>
              )}
              <p className="text-cream-700 font-sans">
                • <strong>Route & Distance:</strong> {ride.pickupLocation.name} ➔ {ride.dropoffLocation.name} ({ride.distanceKm} km)
              </p>
            </div>

            <div className="pt-2 space-y-2">
              <a
                href="tel:0352251662"
                className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-xs font-display font-bold shadow-xs"
              >
                <Phone className="w-4 h-4" />
                <span>Call Dumaguete TMO Hotline: (035) 225-1662</span>
              </a>
              <button
                onClick={handleResetAndClose}
                className="w-full bg-cream-50 hover:bg-cream-200 text-trust-slate font-display font-bold py-2.5 rounded-pill transition text-xs border border-cream-300 shadow-2xs"
              >
                Back to Active Trip
              </button>
            </div>
          </div>
        ) : (
          /* Complaint Form View */
          <form onSubmit={handleSubmit} className="gt-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {/* Driver Identity Card */}
            <div className="bg-trust-slate text-cream-50 p-4 rounded-card border border-cream-400/20 flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                {driver?.avatar && (
                  <img
                    src={driver.avatar}
                    alt={driver.name}
                    className="w-11 h-11 rounded-card object-cover border border-trike-gold shrink-0 shadow-xs"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="bg-trike-gold text-trust-slate font-display font-extrabold text-[11px] px-2 py-0.5 rounded-pill">
                      {driver?.unitNumber || 'Motorcab'}
                    </span>
                    <span className="text-xs text-cream-300 font-sans font-bold truncate">
                      {driver?.vehicleType ? VEHICLE_DETAILS[driver.vehicleType]?.title ?? 'Motorcab' : 'Motorcab'}
                    </span>
                  </div>
                  <h4 className="font-display font-bold text-sm text-cream-50 truncate mt-0.5">
                    Driver: {driver?.name || 'Assigned Driver'}
                  </h4>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="text-[10px] uppercase text-cream-300 block kicker-label font-bold">Standard Fare</span>
                <span className="text-lg font-display font-extrabold text-trike-gold">₱{ride.totalFare}</span>
                <span className="text-[10px] font-sans text-cream-300 block">({ride.distanceKm} km)</span>
              </div>
            </div>

            <div>
              <label className="kicker-label mb-2 block">
                What happened?
              </label>
              <div className="grid grid-cols-2 gap-2">
                {VIOLATIONS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setViolationType(v.key)}
                    className={`flex items-center gap-2 rounded-card border p-3 text-left transition-all active:scale-[0.98] ${
                      violationType === v.key
                        ? 'border-sunset-coral bg-sunset-coral/15 text-sunset-coral font-display font-bold shadow-xs'
                        : 'border-cream-300 bg-cream-50 text-trust-slate font-sans hover:border-sunset-coral/50 hover:bg-sunset-coral/5'
                    }`}
                  >
                    <span className="shrink-0 text-base leading-none">{v.glyph}</span>
                    <span className="text-xs font-semibold leading-tight">{v.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Overcharging Fare Input */}
            {violationType === 'overcharging' && (
              <div className="bg-cream-100 p-3.5 rounded-card border border-sunset-coral/30 space-y-1.5">
                <label className="text-xs font-display font-bold text-trust-slate block">
                  How much fare did the rider ask or demand?
                </label>
                <div className="flex items-center gap-2">
                  <span className="font-display font-extrabold text-base text-trust-slate">₱</span>
                  <input
                    type="number"
                    value={demandedFare}
                    onChange={(e) => setDemandedFare(e.target.value)}
                    placeholder={`e.g. 50 (Calculated fare is ₱${ride.totalFare})`}
                    className="flex-1 bg-cream-50 border border-cream-300 rounded-card px-3 py-1.5 text-xs font-sans font-bold text-trust-slate focus:outline-none focus:border-trike-gold"
                    required
                  />
                </div>
                <p className="text-[10px] text-cream-600 font-sans font-medium">
                  Official Ordinance Rate is ₱{ride.totalFare} for {ride.distanceKm} km. Charging above the published rate is a violation.
                </p>
              </div>
            )}

            {/* Incident Description */}
            <div>
              <label className="kicker-label mb-2 block">
                Tell us what happened
              </label>
              <textarea
                value={incidentDetails}
                onChange={(e) => setIncidentDetails(e.target.value)}
                placeholder="What was said or done, and where"
                rows={3}
                className="w-full rounded-card border border-cream-300 bg-cream-50 p-3 text-xs font-sans text-trust-slate outline-none focus:border-trike-gold"
                required
              />
            </div>

            {/* Passenger Contact Number */}
            <div>
              <label className="kicker-label mb-2 block">
                Your contact number
              </label>
              <input
                type="text"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="So the office can reach you"
                className="w-full rounded-card border border-cream-300 bg-cream-50 px-3 py-2.5 text-xs font-sans font-semibold text-trust-slate outline-none focus:border-trike-gold"
                required
              />
            </div>

            {/* Submit Action CTA */}
            <div className="pt-2 space-y-2">
              {submitError && (
                <p className="text-[11px] font-sans font-bold text-sunset-coral bg-sunset-coral/15 border border-sunset-coral/30 rounded-card px-3 py-2">
                  {submitError}
                </p>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-sunset-coral hover:bg-sunset-coral/90 text-sm font-display font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50"
              >
                <FileText className="h-4 w-4" />
                {isSubmitting ? 'Filing report...' : 'Submit report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
    </Portal>
  );
};
