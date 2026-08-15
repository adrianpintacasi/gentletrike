import React from 'react';
import { Home, Receipt, Menu } from 'lucide-react';

/**
 * The phone tab bar: three destinations, floating over the app in a dark pill.
 *
 * Booking is deliberately absent. It is not a place you go — it is what happens
 * after you answer "where do you want to go?", so putting it in the bar asked
 * the passenger to navigate to a flow they were already in the middle of.
 *
 * Dark rather than white because it sits over a pale map and a white sheet; a
 * white pill on either of those has to be found before it can be used.
 */

export type NavTab = 'home' | 'ride' | 'fares' | 'menu';

/** The three that actually appear as buttons. `ride` is entered, never chosen. */
const TABS = [
  { key: 'home' as const, label: 'Home', icon: Home },
  { key: 'fares' as const, label: 'Fares', icon: Receipt },
  { key: 'menu' as const, label: 'Menu', icon: Menu },
];

interface BottomNavProps {
  tab: NavTab;
  onTabChange: (tab: NavTab) => void;
  /** Shown as a dot on Home when a rider has offers waiting. */
  badgeCount?: number;
}

/** Pill height plus the gap beneath it, so content can sit clear of both. */
export const BOTTOM_NAV_HEIGHT = 84;

export const BottomNav: React.FC<BottomNavProps> = ({ tab, onTabChange, badgeCount = 0 }) => (
  <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
    <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-gray-900 p-2 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`relative flex h-12 items-center justify-center rounded-full transition-all active:scale-95 ${
              active
                ? 'gap-2 bg-yellow-400 px-5 text-gray-900'
                : 'w-12 text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {/* Only the active tab is labelled, so three destinations fit a
                narrow phone without shrinking the tap targets. */}
            {active && <span className="text-xs font-semibold">{label}</span>}
            {key === 'home' && badgeCount > 0 && !active && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {badgeCount > 9 ? '9+' : badgeCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  </nav>
);
