import React from 'react';
import { Home, Receipt, Menu } from 'lucide-react';

/**
 * The passenger tab bar: three destinations, floating over the app in a dark pill.
 *
 * Booking is deliberately absent. It is not a place you go — it is what happens
 * after you answer "where do you want to go?", so putting it in the bar asked
 * the passenger to navigate to a flow they were already in the middle of.
 *
 * Dark rather than white because it sits over a pale map and a white sheet; a
 * white pill on either of those has to be found before it can be used.
 */

export type NavTab = 'home' | 'ride' | 'fares' | 'menu';

/** What a passenger navigates. `ride` is entered, never chosen. */
const PASSENGER_TABS = [
  { key: 'home' as const, label: 'Home', icon: Home },
  { key: 'fares' as const, label: 'Fares', icon: Receipt },
  { key: 'menu' as const, label: 'Menu', icon: Menu },
];

/*
 * Riders have no bar.
 *
 * Theirs held Drive and Menu. Drive was not a destination — it was the screen
 * behind the bar, so the tab was a button that took you where you already were.
 * That left one real target, which did not justify a pill across the bottom of
 * a map, least of all one overlapping the sheet the offers arrive in.
 *
 * Menu moved to a circle beside Gently, at the top. See App.
 */

interface BottomNavProps {
  tab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

/** Pill height plus the gap beneath it, so content can sit clear of both. */
export const BOTTOM_NAV_HEIGHT = 84;

export const BottomNav: React.FC<BottomNavProps> = ({
  tab,
  onTabChange,
}) => (
  <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
    <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-gray-900 p-2 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
      {PASSENGER_TABS.map(({ key, label, icon: Icon }) => {
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
          </button>
        );
      })}
    </div>
  </nav>
);
