import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export type ActionTone = 'default' | 'warning' | 'danger' | 'success';

export interface ActionItem {
  label: string;
  tone?: ActionTone;
  icon?: React.ReactNode;
  onClick: () => void;
}

const TONE: Record<ActionTone, string> = {
  default: 'text-trust-slate hover:bg-cream-200',
  warning: 'text-sunset-coral hover:bg-sunset-coral/10',
  danger: 'text-sunset-coral hover:bg-sunset-coral/15 font-bold',
  success: 'text-sampaguita-green hover:bg-sampaguita-green/10',
};

/**
 * A compact icon-only dropdown (▾) whose menu is portaled to <body> so a table's
 * overflow can't clip it. Used across the admin tables for a consistent look.
 */
export const ActionMenu: React.FC<{ items: ActionItem[] }> = ({ items }) => {
  const [pos, setPos] = useState<{ right: number; y: number } | null>(null);
  if (items.length === 0) return null;

  return (
    <>
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ right: Math.max(8, window.innerWidth - r.right), y: r.bottom });
        }}
        className="inline-flex items-center justify-center p-1.5 rounded-card text-cream-700 border border-cream-300 bg-cream-50 hover:text-trust-slate hover:bg-cream-200 transition shadow-2xs"
        title="Actions"
      >
        <ChevronDown className="w-4 h-4" />
      </button>

      {pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
            <div
              className="fixed z-50 w-max bg-cream-50 rounded-card border border-cream-300 shadow-xl py-1 animate-fadeIn"
              style={{ top: pos.y + 6, right: pos.right }}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  onClick={() => {
                    it.onClick();
                    setPos(null);
                  }}
                  className={`w-full flex items-center gap-2 px-3.5 py-2 text-xs font-display font-bold whitespace-nowrap transition ${
                    TONE[it.tone ?? 'default']
                  }`}
                >
                  {it.icon && <span className="shrink-0">{it.icon}</span>}
                  {it.label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
};
