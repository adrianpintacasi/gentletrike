import React from 'react';
import { X, CheckCircle, Scale } from 'lucide-react';

interface FareMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FareMatrixModal: React.FC<FareMatrixModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-200 flex flex-col gap-4 text-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-xl border border-amber-200">
              <Scale className="w-5 h-5 text-amber-800" />
            </div>
            <div>
              <h3 className="font-bold text-base text-gray-900">GentleTrike Fare Matrix</h3>
              <p className="text-xs text-gray-500 font-medium">Dumaguete Motorcab Ordinance Standards</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="space-y-3 text-xs font-medium">
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 space-y-1.5">
            <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-amber-700" />
              <span>Standard City Fare Rate:</span>
            </h4>
            <p className="text-gray-800">
              • <span className="font-bold">₱15.00 Base Fare</span> for 1.0 kilometer or less.
            </p>
            <p className="text-gray-800">
              • <span className="font-bold">+₱2.00 / km</span> for every succeeding kilometer{' '}
              <span className="font-bold">or fraction thereof</span> — a trip even slightly past
              1.0 km already pays the full ₱2.
            </p>
            <div className="bg-white/70 rounded-lg border border-amber-200 px-3 py-2 mt-1.5">
              <p className="text-[11px] font-bold text-gray-700 mb-1">Worked examples:</p>
              <p className="text-[11px] text-gray-700">1.00 km → ₱15 &nbsp;•&nbsp; 1.01 km → ₱17 &nbsp;•&nbsp; 1.70 km → ₱17</p>
              <p className="text-[11px] text-gray-700">2.00 km → ₱17 &nbsp;•&nbsp; 2.01 km → ₱19 &nbsp;•&nbsp; 2.90 km → ₱19</p>
            </div>
            <p className="text-[11px] text-gray-600 pt-0.5">
              Distance is the actual road distance driven, not the straight line between points.
            </p>
          </div>

          <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 space-y-1">
            <h4 className="font-bold text-gray-900 text-xs">🤝 Pakyaw / Charter Guidelines:</h4>
            <p className="text-gray-600 font-medium">
              Out-of-city routes (e.g. Valencia, Airport with heavy baggage) use custom Pakyaw agreements (typically ₱100–₱200).
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold py-2.5 rounded-xl shadow-xs transition text-xs"
        >
          Got It, Understood
        </button>
      </div>
    </div>
  );
};
