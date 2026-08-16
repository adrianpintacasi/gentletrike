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
    <header className="bg-cream-50 text-trust-slate border-b border-cream-300 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/GentleTrike.png"
            alt="GentleTrike Logo"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
            className="w-10 h-10 object-contain rounded-xl shadow-xs border border-cream-300 bg-cream-50 shrink-0"
          />
          <div className="min-w-0">
            <h1 className="text-xl font-display font-extrabold text-trust-slate tracking-tight leading-none">
              GentleTrike
            </h1>
            <p className="text-[11px] font-sans font-semibold text-cream-600 truncate">
              {user.name} · {user.role === 'rider' ? 'Rider' : user.role === 'admin' ? 'Admin' : 'Passenger'}
            </p>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-2 bg-cream-100 px-3.5 py-1.5 rounded-full border border-cream-300 text-xs font-sans font-semibold text-cream-700">
          <Sun className="w-4 h-4 text-trike-gold" />
          <span>Dumaguete • 28°C Gentle Breeze</span>
          <span className="w-2 h-2 rounded-full bg-sampaguita-green animate-pulse"></span>
          <span className="text-sampaguita-green font-bold">Boulevard Active</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canUseRiderMode && (
            <button
              onClick={() => onToggleDriverMode(!isDriverMode)}
              className={`px-3.5 py-2 rounded-full font-display font-bold text-xs flex items-center gap-1.5 transition shadow-xs active:scale-95 ${
                isDriverMode
                  ? 'bg-trike-gold text-trust-slate hover:bg-trike-gold-hover border border-trike-gold'
                  : 'bg-cream-200 text-trust-slate hover:bg-cream-300 border border-cream-300'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span className="hidden sm:inline">
                {isDriverMode ? 'Rider Mode' : 'Passenger Mode'}
              </span>
            </button>
          )}

          <button
            onClick={onOpenAiGuide}
            className="btn-gently-ai flex items-center gap-1.5 text-xs px-3.5 py-2 shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ask Gently</span>
          </button>

          {user.role === 'admin' && (
            <button
              onClick={() => onToggleAdminMode(!isAdminMode)}
              className={`px-3.5 py-2 rounded-full font-display font-bold text-xs flex items-center gap-1.5 transition shadow-xs active:scale-95 ${
                isAdminMode
                  ? 'bg-trust-slate text-cream-50 hover:bg-trust-slate/90'
                  : 'bg-cream-200 text-trust-slate hover:bg-cream-300 border border-cream-300'
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
            className="p-2 rounded-full text-trust-slate hover:bg-cream-200 border border-cream-300 transition active:scale-95"
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
