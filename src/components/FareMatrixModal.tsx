import React from 'react';
import { X, Scale } from 'lucide-react';
import { VEHICLE_DETAILS, TRANSPORT_MODES } from '../../shared/transport';
import { BASE_DISTANCE_KM, farePerPassenger } from '../utils/fare';

interface FareMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Distances chosen to show the ceiling rule, including both sides of a boundary. */
const SAMPLE_KM = [1, 1.01, 2, 2.01, 3, 5];

export const FareMatrixModal: React.FC<FareMatrixModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="animate-fadeIn fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-2">
              <Scale className="h-5 w-5 text-amber-800" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight">Official Fare Matrix</h3>
              <p className="text-xs font-medium text-gray-500">
                Dumaguete City Traffic Management Office rates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Rates come from the same table the app bills from, so this panel
              cannot quote a fare the booking screen disagrees with. */}
          <section>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Rates by vehicle
            </h4>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-bold">Vehicle</th>
                    <th className="px-3 py-2 text-right font-bold">First km</th>
                    <th className="px-3 py-2 text-right font-bold">Each km after</th>
                    <th className="px-3 py-2 text-right font-bold">Seats</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {TRANSPORT_MODES.map((mode) => {
                    const v = VEHICLE_DETAILS[mode];
                    return (
                      <tr key={mode}>
                        <td className="px-3 py-2 font-bold text-gray-900">{v.title}</td>
                        <td className="px-3 py-2 text-right font-bold">₱{v.baseFare}.00</td>
                        <td className="px-3 py-2 text-right">₱{v.perKm}.00</td>
                        <td className="px-3 py-2 text-right text-gray-500">{v.maxPassengers}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h4 className="text-sm font-bold text-gray-900">How the distance is charged</h4>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-800">
              The base fare covers the first {BASE_DISTANCE_KM} kilometre or less. Every
              kilometre after that is charged in full{' '}
              <span className="font-bold">or fraction thereof</span> — a trip even slightly
              past a kilometre owes the whole amount, never a proportion of it.
            </p>

            <div className="mt-3 overflow-hidden rounded-lg border border-amber-200 bg-white">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-amber-100/60 text-[10px] uppercase tracking-wider text-amber-900">
                  <tr>
                    <th className="px-3 py-1.5 font-bold">Distance</th>
                    {TRANSPORT_MODES.map((mode) => (
                      <th key={mode} className="px-3 py-1.5 text-right font-bold">
                        {VEHICLE_DETAILS[mode].title.split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {SAMPLE_KM.map((km) => (
                    <tr key={km}>
                      <td className="px-3 py-1.5 font-bold text-gray-700">
                        {km.toFixed(2)} km
                      </td>
                      {TRANSPORT_MODES.map((mode) => (
                        <td key={mode} className="px-3 py-1.5 text-right font-bold text-gray-900">
                          ₱{farePerPassenger(mode, km)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-[11px] text-gray-600">
              Fares are per passenger, and distance is measured along the actual roads driven,
              not the straight line between two points.
            </p>
          </section>

          <section className="space-y-3 text-xs">
            <div>
              <h4 className="text-sm font-bold text-gray-900">Discounts</h4>
              <p className="mt-1 leading-relaxed text-gray-600">
                Students, senior citizens and persons with disability are entitled to 20% off on
                presentation of a valid ID. GentleTrike quotes and books the full fare — please
                arrange the discount directly with your rider.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-bold text-gray-900">Pakyaw Charter (Out-of-City)</h4>
              <p className="mt-1 leading-relaxed text-gray-600">
                Charter rate for out-of-city destinations (Valencia, airport, etc.): ₱70 base fare for the first kilometre, plus ₱5 per succeeding kilometre. This is a flat rate regardless of the number of passengers. Custom negotiated fares must not be lower than the calculated ordinance fare.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-bold text-gray-900">If you are overcharged</h4>
              <p className="mt-1 leading-relaxed text-gray-600">
                Charging above these rates is a violation. Report it in the app, or contact the
                Traffic Management Office at (035) 225-1662. A formal complaint requires the
                passenger to appear at the TMO office in person.
              </p>
            </div>
          </section>
        </div>

        <div className="shrink-0 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onClose}
            className="min-h-11 w-full rounded-xl bg-gray-900 text-xs font-bold text-amber-400 shadow-xs transition active:scale-[0.99] hover:bg-black"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
