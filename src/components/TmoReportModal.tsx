import React, { useState } from 'react';
import { RideBooking } from '../types';
import { ShieldAlert, X, AlertTriangle, CheckCircle, Phone, FileText } from 'lucide-react';
import * as api from '../api';

interface TmoReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  ride: RideBooking;
}

export const TmoReportModal: React.FC<TmoReportModalProps> = ({ isOpen, onClose, ride }) => {
  const [violationType, setViolationType] = useState<'overcharging' | 'harassment' | 'refusal' | 'reckless' | 'other'>('overcharging');
  const [demandedFare, setDemandedFare] = useState<string>('');
  const [incidentDetails, setIncidentDetails] = useState<string>('');
  const [contactNumber, setContactNumber] = useState<string>('0917-890-1234');
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
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-rose-200 text-gray-900 flex flex-col">
        {/* Modal Header */}
        <div className="bg-rose-900 text-white p-4 sm:p-5 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-700 rounded-xl shadow-xs">
              <ShieldAlert className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <h3 className="font-extrabold text-base leading-tight text-white flex items-center gap-2">
                <span>Dumaguete TMO Complaint Portal</span>
              </h3>
              <p className="text-xs text-rose-200 font-medium">
                Traffic Management Office • City Ordinance Enforcement
              </p>
            </div>
          </div>

          <button
            onClick={handleResetAndClose}
            className="p-1.5 hover:bg-rose-800 rounded-full transition text-rose-200 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submittedReference ? (
          /* Confirmation View */
          <div className="p-6 space-y-5 text-center">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-300 shadow-sm">
              <CheckCircle className="w-9 h-9" />
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 inline-block mb-2">
                Complaint Successfully Logged
              </span>
              <h4 className="text-xl font-extrabold text-gray-900">Reference: {submittedReference}</h4>
              <p className="text-xs text-gray-600 mt-2 font-medium max-w-md mx-auto">
                Your report against Motorcab <strong className="text-gray-900">{driver?.unitNumber || 'Unit'}</strong> (Plate: {driver?.plateNumber}) has been submitted to the Dumaguete Traffic Management Office (TMO) Enforcement Division.
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
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
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
                      Plate: {driver?.plateNumber || 'N/A'}
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

            {/* Violation Category Selection */}
            <div>
              <label className="text-xs font-extrabold uppercase tracking-wider text-gray-700 block mb-2">
                1. Select Issue / Violation Category:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setViolationType('overcharging')}
                  className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                    violationType === 'overcharging'
                      ? 'bg-rose-50 border-rose-500 text-rose-900 font-bold shadow-xs'
                      : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold'
                  }`}
                >
                  <span className="text-lg">💰</span>
                  <div>
                    <p className="text-xs leading-tight">Asked Higher Fare</p>
                    <p className="text-[10px] text-gray-500 font-normal">Overcharging above calculated fare</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setViolationType('harassment')}
                  className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                    violationType === 'harassment'
                      ? 'bg-rose-50 border-rose-500 text-rose-900 font-bold shadow-xs'
                      : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold'
                  }`}
                >
                  <span className="text-lg">🗣️</span>
                  <div>
                    <p className="text-xs leading-tight">Rider Harassment</p>
                    <p className="text-[10px] text-gray-500 font-normal">Verbal abuse, threat, or disrespect</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setViolationType('refusal')}
                  className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                    violationType === 'refusal'
                      ? 'bg-rose-50 border-rose-500 text-rose-900 font-bold shadow-xs'
                      : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold'
                  }`}
                >
                  <span className="text-lg">🚫</span>
                  <div>
                    <p className="text-xs leading-tight">Refusal of Conveyance</p>
                    <p className="text-[10px] text-gray-500 font-normal">Refusing or dropping off mid-way</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setViolationType('reckless')}
                  className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                    violationType === 'reckless'
                      ? 'bg-rose-50 border-rose-500 text-rose-900 font-bold shadow-xs'
                      : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold'
                  }`}
                >
                  <span className="text-lg">🛵</span>
                  <div>
                    <p className="text-xs leading-tight">Reckless Driving</p>
                    <p className="text-[10px] text-gray-500 font-normal">Unsafe speed or motorcab condition</p>
                  </div>
                </button>
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
                  Official Ordinance Rate is ₱{ride.totalFare} for {ride.distanceKm} km. Demanding higher fares violates Dumaguete Motorcab License Rules.
                </p>
              </div>
            )}

            {/* Incident Description */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-gray-700 block mb-1">
                2. Incident Details / Statement:
              </label>
              <textarea
                value={incidentDetails}
                onChange={(e) => setIncidentDetails(e.target.value)}
                placeholder="Describe what happened (e.g., rider insisted on charging ₱50 instead of ₱20 fare)..."
                rows={3}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs font-medium text-gray-900 focus:outline-none focus:bg-white focus:border-rose-400"
                required
              />
            </div>

            {/* Passenger Contact Number */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-gray-700 block mb-1">
                3. Passenger Contact No. (For TMO Verification):
              </label>
              <input
                type="text"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="0917-XXX-XXXX"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:outline-none focus:bg-white focus:border-rose-400"
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
                className="w-full bg-rose-600 hover:bg-rose-700 disabled:bg-gray-300 disabled:text-gray-500 text-white font-extrabold py-3 rounded-xl shadow-md transition active:scale-95 flex items-center justify-center gap-2 text-xs"
              >
                <FileText className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? 'Filing report...'
                    : 'File Official Report to Dumaguete TMO'}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
