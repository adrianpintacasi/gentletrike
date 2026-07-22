import React from 'react';
import { Sparkles, Sun, UserCheck } from 'lucide-react';

interface NavbarProps {
  isDriverMode: boolean;
  onToggleDriverMode: (isDriver: boolean) => void;
  onOpenAiGuide: () => void;
  onOpenFareGuide: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  isDriverMode,
  onToggleDriverMode,
  onOpenAiGuide,
}) => {
  return (
    <header className="bg-white text-black border-b border-gray-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {/* Logo & GentleTrike Title Only */}
        <div className="flex items-center gap-3">
          <img
            src="/GentleTrike.png"
            alt="GentleTrike Logo"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
            className="w-10 h-10 object-contain rounded-xl shadow-xs border border-amber-200 bg-white"
          />
          <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none">
            GentleTrike
          </h1>
        </div>

        {/* Live Weather / Boulevard Status */}
        <div className="hidden lg:flex items-center gap-2 bg-gray-50 px-3.5 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-700">
          <Sun className="w-4 h-4 text-amber-500" />
          <span>Dumaguete • 28°C Gentle Breeze</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-emerald-700 font-bold">Boulevard Active</span>
        </div>

        {/* Actions & Mode Switch */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenAiGuide}
            className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-bold text-xs px-3 py-2 rounded-xl transition shadow-xs active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Gentle AI</span>
          </button>

          <button
            onClick={() => onToggleDriverMode(!isDriverMode)}
            className={`px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shadow-xs active:scale-95 ${
              isDriverMode
                ? 'bg-gray-900 text-yellow-400 hover:bg-gray-800'
                : 'bg-gray-100 text-gray-900 hover:bg-gray-200 border border-gray-200'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>{isDriverMode ? 'Rider Mode Active' : 'Switch to Rider'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

