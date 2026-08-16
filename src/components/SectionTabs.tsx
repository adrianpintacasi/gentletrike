import React from 'react';
import { Home, Receipt, Menu } from 'lucide-react';
import type { NavTab } from './BottomNav';

/**
 * The desktop equivalent of the phone tab bar.
 *
 * Three destinations. Gently sits beside this strip rather than inside it: it
 * is not a place you navigate to, and putting it in the same container implied
 * it was a fourth tab.
 *
 * Booking is absent for the same reason it is absent from the phone bar: it is
 * entered by naming a destination, never chosen from a menu.
 */

const TABS = [
  { key: 'home' as const, label: 'Home', icon: Home },
  { key: 'fares' as const, label: 'Fares', icon: Receipt },
  { key: 'menu' as const, label: 'Menu', icon: Menu },
];

interface SectionTabsProps {
  tab: NavTab;
  onTabChange: (tab: NavTab) => void;
  badgeCount?: number;
}

export const SectionTabs: React.FC<SectionTabsProps> = ({
  tab,
  onTabChange,
  badgeCount = 0,
}) => (
  <nav className="flex flex-1 items-center gap-1.5 rounded-2xl border border-cream-300 bg-cream-50 p-1.5 shadow-xs">
    {TABS.map(({ key, label, icon: Icon }) => {
      const active = tab === key;
      return (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          aria-current={active ? 'page' : undefined}
          className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition ${
            active
              ? 'bg-trike-gold text-trust-slate font-display font-bold shadow-xs'
              : 'text-cream-600 hover:bg-cream-200 hover:text-trust-slate'
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
          {key === 'home' && badgeCount > 0 && !active && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-sunset-coral px-1 text-[9px] font-bold text-white">
              {badgeCount > 9 ? '9+' : badgeCount}
            </span>
          )}
        </button>
      );
    })}

  </nav>
);
