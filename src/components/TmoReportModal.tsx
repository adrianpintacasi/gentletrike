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
    <div className="animate-fadeIn fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white text-gray-900 shadow-2xl">
        {/* One name. The office a complaint reaches depends on where the trip
            happened, and this app is meant to travel past one city, so naming
            a specific one in the title would go stale the moment it does. */}
        <div className="flex shrink-0 items-center justify-between bg-rose-700 px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold leading-tight">Complaint Portal</h3>
              <p className="text-[11px] text-white/70">Filed with your local transport office</p>
            </div>
          </div>

          <button
            onClick={handleResetAndClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submittedReference ? (
          /* Confirmation View */
          <div className="gt-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-center">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-300 shadow-sm">
              <CheckCircle className="w-9 h-9" />
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 inline-block mb-2">
                Complaint Successfully Logged
              </span>
              <h4 className="text-xl font-extrabold text-gray-900">Reference: {submittedReference}</h4>
              <p className="text-xs text-gray-600 mt-2 font-medium max-w-md mx-auto">
                Your report against Motorcab <strong className="text-gray-900">{driver?.unitNumber || 'Unit'}</strong> has been submitted to your local transport office.
              </p>
            </div>

            <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 text-left text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Summary of Flagged Incident:</span>
              </div>
              <p className="text-gray-800">
                • <strong>Category:</strong> {violationType.toUpperCase()}
              </p>
              {demandedFare && (
                <p className="text-gray-800">
                  • <strong>Overcharge Claim:</strong> Demanded ₱{demandedFare} vs. Auto-Calculated ₱{ride.totalFare}
                </p>
              )}
              <p className="text-gray-800">
                • <strong>Route & Distance:</strong> {ride.pickupLocation.name} ➔ {ride.dropoffLocation.name} ({ride.distanceKm} km)
              </p>
            </div>

            <div className="pt-2 space-y-2">
              <a
                href="tel:0352251662"
                className="w-full bg-gray-900 hover:bg-black text-amber-400 font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 text-xs shadow-xs"
              >
                <Phone className="w-4 h-4" />
                <span>Call Dumaguete TMO Hotline: (035) 225-1662</span>
              </a>
              <button
                onClick={handleResetAndClose}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 rounded-xl transition text-xs border border-gray-200"
              >
                Back to Active Trip
              </button>
            </div>
          </div>
        ) : (
          /* Complaint Form View */
          <form onSubmit={handleSubmit} className="gt-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {/* Driver Identity Card */}
            <div className="bg-gray-900 text-white p-4 rounded-xl border border-gray-800 flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                {driver?.avatar && (
                  <img
                    src={driver.avatar}
                    alt={driver.name}
                    className="w-11 h-11 rounded-xl object-cover border border-amber-400 shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-400 text-gray-900 font-extrabold text-[11px] px-2 py-0.5 rounded-md">
                      {driver?.unitNumber || 'Motorcab'}
                    </span>
                    <span className="text-xs text-gray-300 font-bold truncate">
                      {driver?.vehicleType ? VEHICLE_DETAILS[driver.vehicleType]?.title ?? 'Motorcab' : 'Motorcab'}
                    </span>
                  </div>
                  <h4 className="font-bold text-sm text-white truncate mt-0.5">
                    Rider: {driver?.name || 'Assigned Driver'}
                  </h4>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="text-[10px] uppercase text-gray-400 block font-bold">Standard Fare</span>
                <span className="text-lg font-extrabold text-amber-400">₱{ride.totalFare}</span>
                <span className="text-[10px] text-gray-400 block">({ride.distanceKm} km)</span>
              </div>
            </div>

            {/* What happened. Two columns of short labels; the sentences that
                used to sit under each one were reading material between the
                passenger and the form. */}
            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                What happened?
              </label>
              <div className="grid grid-cols-2 gap-2">
                {VIOLATIONS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setViolationType(v.key)}
                    className={`flex items-center gap-2 rounded-xl border p-3 text-left transition-all active:scale-[0.98] ${
                      violationType === v.key
                        ? 'border-rose-500 bg-rose-50 text-rose-900 shadow-xs'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-rose-200 hover:bg-rose-50/40'
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
              <div className="bg-rose-50 p-3.5 rounded-xl border border-rose-200 space-y-1.5">
                <label className="text-xs font-bold text-rose-900 block">
                  How much fare did the rider ask or demand?
                </label>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-base text-gray-900">₱</span>
                  <input
                    type="number"
                    value={demandedFare}
                    onChange={(e) => setDemandedFare(e.target.value)}
                    placeholder={`e.g. 50 (Calculated fare is ₱${ride.totalFare})`}
                    className="flex-1 bg-white border border-rose-300 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                    required
                  />
                </div>
                <p className="text-[10px] text-rose-700 font-medium">
                  Official Ordinance Rate is ₱{ride.totalFare} for {ride.distanceKm} km. Charging above the published rate is a violation.
                </p>
              </div>
            )}

            {/* Incident Description */}
            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Tell us what happened
              </label>
              <textarea
                value={incidentDetails}
                onChange={(e) => setIncidentDetails(e.target.value)}
                placeholder="What was said or done, and where"
                rows={3}
                className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-900 outline-none focus:border-rose-400"
                required
              />
            </div>

            {/* Passenger Contact Number */}
            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Your contact number
              </label>
              <input
                type="text"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="So the office can reach you"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-gray-900 outline-none focus:border-rose-400"
                required
              />
            </div>

            {/* Submit Action CTA */}
            <div className="pt-2 space-y-2">
              {submitError && (
                <p className="text-[11px] font-bold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {submitError}
                </p>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 text-sm font-semibold text-white shadow-sm transition active:scale-[0.99] hover:bg-rose-700 disabled:bg-gray-300 disabled:text-gray-500"
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
