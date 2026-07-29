import React from 'react';
import { LogOut, Sparkles, Sun, UserCheck, Shield } from 'lucide-react';
import type { User } from '../types/auth';

interface NavbarProps {
  user: User;
  isDriverMode: boolean;
  isAdminMode: boolean;
  canUseRiderMode: boolean;
  onToggleDriverMode: (isDriver: boolean) => void;
  onToggleAdminMode: (isAdmin: boolean) => void;
  onOpenAiGuide: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  isDriverMode,
  isAdminMode,
  canUseRiderMode,
  onToggleDriverMode,
  onToggleAdminMode,
  onOpenAiGuide,
  onLogout,
}) => {
  return (
    <header className="bg-white text-black border-b border-gray-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/GentleTrike.png"
            alt="GentleTrike Logo"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
            className="w-10 h-10 object-contain rounded-xl shadow-xs border border-amber-200 bg-white shrink-0"
          />
          <div className="min-w-0">
            <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none">
              GentleTrike
            </h1>
            <p className="text-[11px] font-semibold text-gray-500 truncate">
              {user.name} · {user.role === 'rider' ? 'Rider' : user.role === 'admin' ? 'Admin' : 'Passenger'}
            </p>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-2 bg-gray-50 px-3.5 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-700">
          <Sun className="w-4 h-4 text-amber-500" />
          <span>Dumaguete • 28°C Gentle Breeze</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-emerald-700 font-bold">Boulevard Active</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenAiGuide}
            className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-bold text-xs px-3 py-2 rounded-xl transition shadow-xs active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ask Gently</span>
          </button>

          {user.role === 'admin' && (
            <button
              onClick={() => onToggleAdminMode(!isAdminMode)}
              className={`px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shadow-xs active:scale-95 ${
                isAdminMode
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">
                {isAdminMode ? 'Admin View Active' : 'Admin'}
              </span>
            </button>
          )}

          <button
            onClick={onLogout}
            className="p-2 rounded-xl text-gray-600 hover:bg-gray-100 border border-gray-200 transition active:scale-95"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
