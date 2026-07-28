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
  default: 'text-gray-700 hover:bg-gray-100',
  warning: 'text-orange-700 hover:bg-orange-50',
  danger: 'text-red-600 hover:bg-red-50',
  success: 'text-emerald-700 hover:bg-emerald-50',
};

/**
 * A compact icon-only dropdown (▾) whose menu is portaled to <body> so a table's
 * overflow can't clip it. Used across the admin tables for a consistent look.
 */
export const ActionMenu: React.FC<{ items: ActionItem[] }> = ({ items }) => {
  // Anchor the menu's RIGHT edge to the button's right edge, and let it size to
  // its content — so there's no wasted whitespace and it never overflows right.
  const [pos, setPos] = useState<{ right: number; y: number } | null>(null);
  if (items.length === 0) return null;

  return (
    <>
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ right: Math.max(8, window.innerWidth - r.right), y: r.bottom });
        }}
        className="inline-flex items-center justify-center p-1.5 rounded-lg text-gray-500 border border-gray-200 hover:text-gray-700 hover:bg-gray-100 transition"
        title="Actions"
      >
        <ChevronDown className="w-4 h-4" />
      </button>

      {pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
            <div
              className="fixed z-50 w-max bg-white rounded-xl border border-gray-200 shadow-lg py-1 animate-fadeIn"
              style={{ top: pos.y + 6, right: pos.right }}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  onClick={() => {
                    it.onClick();
                    setPos(null);
                  }}
                  className={`w-full flex items-center gap-2 px-3.5 py-2 text-xs font-bold whitespace-nowrap transition ${
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
