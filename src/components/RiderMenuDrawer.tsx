import React from 'react';
import { X } from 'lucide-react';
import { Portal } from './Portal';
import { MenuPage } from './MenuPage';
import type { Driver } from '../types';
import type { HistoryRide, MyReport, TodayTotals } from '../api';

interface RiderMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: { name: string; role: 'passenger' | 'rider' | 'admin'; contact_number?: string };
  driver: Driver | null;
  today: TodayTotals | null;
  history: HistoryRide[];
  reports: MyReport[];
  isLoading: boolean;
  canUseRiderMode: boolean;
  isDriverMode: boolean;
  onToggleDriverMode: () => void;
  onLogout: () => void;
  onContactChanged?: (contactNumber: string) => void;
  onSeatCapacityChange?: (seats: number) => void;
}

export const RiderMenuDrawer: React.FC<RiderMenuDrawerProps> = ({
  isOpen,
  onClose,
  user,
  driver,
  today,
  history,
  reports,
  isLoading,
  canUseRiderMode,
  isDriverMode,
  onToggleDriverMode,
  onLogout,
  onContactChanged,
  onSeatCapacityChange,
}) => {
  return (
    <Portal>
      <div
        className={`fixed inset-0 z-50 transition-all duration-300 ${
          isOpen ? 'pointer-events-auto visible' : 'pointer-events-none invisible delay-300'
        }`}
      >
        {/* Dark Backdrop */}
        <div
          className={`fixed inset-0 bg-trust-slate/60 backdrop-blur-xs transition-opacity duration-300 ${
            isOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Drawer Sliding Out from Left to Right */}
        <div
          className={`fixed inset-y-0 left-0 z-50 flex h-full w-[88vw] max-w-sm flex-col border-r border-cream-300 bg-cream-50 shadow-2xl transition-transform duration-300 ease-gentle ${
            isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {/* Drawer Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-cream-200 px-5 py-3.5 bg-cream-50">
            <div className="flex items-center gap-2.5">
              <img
                src="/GentleTrike.png"
                alt="GentleTrike"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
                className="h-8 w-8 rounded-full bg-cream-50 object-contain shadow-2xs border border-cream-300"
              />
              <div>
                <h2 className="font-display font-black text-base text-trust-slate leading-none">
                  GentleTrike
                </h2>
                <p className="text-[10px] font-sans font-bold text-cream-600 mt-0.5">
                  {isDriverMode
                    ? `Driver Dashboard · Unit #${driver?.unitNumber || '104'}`
                    : `${user.name.split(' ')[0]} · Passenger`}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close menu drawer"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-cream-200 text-trust-slate hover:bg-cream-300 transition active:scale-95 shadow-2xs"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Drawer Content */}
          <div className="gt-scroll flex-1 overflow-y-auto px-5 py-4">
            <MenuPage
              user={user}
              driver={driver}
              today={today}
              history={history}
              reports={reports}
              isLoading={isLoading}
              canUseRiderMode={canUseRiderMode}
              isDriverMode={isDriverMode}
              onToggleDriverMode={onToggleDriverMode}
              onLogout={onLogout}
              onContactChanged={onContactChanged}
              onSeatCapacityChange={onSeatCapacityChange}
              onBackToHome={onClose}
            />
          </div>
        </div>
      </div>
    </Portal>
  );
};
