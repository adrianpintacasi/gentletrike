import React from 'react';

/**
 * The draggable panel that sits over the map on a phone.
 *
 * The problem it solves: the old layout stacked the booking panel above a fixed
 * 480px map, so a rider had to scroll past the whole request queue to see the
 * road, and the primary action scrolled away with it. Here the map owns the
 * whole viewport, the page itself never scrolls, and the sheet slides over it.
 *
 * Three rules make that work:
 *   1. Only the sheet's content scrolls. The page has no scrollbar at all.
 *   2. `pinned` never scrolls. Whatever the user must tap next lives there, so
 *      it is on screen at the smallest snap point without any scrolling.
 *   3. The visible height is reported upward so the map can pad its viewport and
 *      keep the route clear of the sheet.
 */

export type SheetSnap = 'peek' | 'half' | 'full';

/** Fractions of viewport height. Peek fits the grabber plus one pinned row. */
const SNAP_FRACTIONS: Record<SheetSnap, number> = {
  peek: 0.26,
  half: 0.55,
  full: 0.9,
};

const ORDER: SheetSnap[] = ['peek', 'half', 'full'];

interface BottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Always visible, never scrolls — the next action and its one line of context. */
  pinned?: React.ReactNode;
  children: React.ReactNode;
  /** Space reserved at the bottom for the tab bar, in px. */
  bottomOffset?: number;
  /** Visible height in px, reported on every settle so the map can pad itself. */
  onHeightChange?: (height: number) => void;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  snap,
  onSnapChange,
  pinned,
  children,
  bottomOffset = 0,
  onHeightChange,
}) => {
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const [viewportH, setViewportH] = React.useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight
  );
  /** Non-null only while a finger is down; drives the live drag offset. */
  const [dragOffset, setDragOffset] = React.useState<number | null>(null);
  const dragStart = React.useRef<{ y: number; offset: number } | null>(null);

  React.useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The sheet is anchored to the bottom of the screen, not above the tab bar.
  // Insetting it left a strip of map showing *below* the sheet and behind the
  // floating pill, which read as a rendering fault rather than a design.
  // `bottomOffset` now only pads the content, so the last row still clears
  // the tab bar.
  const available = viewportH;
  const heightFor = (s: SheetSnap) => Math.round(SNAP_FRACTIONS[s] * available);
  const fullHeight = heightFor('full');

  /** How far the sheet is pushed down from its fully-open position. */
  const offsetFor = (s: SheetSnap) => fullHeight - heightFor(s);
  const maxOffset = offsetFor('peek');

  const settledOffset = offsetFor(snap);
  const currentOffset = dragOffset ?? settledOffset;
  const visibleHeight = fullHeight - currentOffset;

  // Report only the settled height. Emitting on every drag frame would make the
  // map recompute its padding dozens of times a second for no visual gain.
  React.useEffect(() => {
    onHeightChange?.(fullHeight - settledOffset + bottomOffset);
  }, [settledOffset, fullHeight, bottomOffset, onHeightChange]);

  const onPointerDown = (event: React.PointerEvent) => {
    // Ignore the second finger of a pinch; one drag at a time.
    if (dragStart.current) return;
    dragStart.current = { y: event.clientY, offset: currentOffset };
    setDragOffset(currentOffset);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const next = start.offset + (event.clientY - start.y);
    setDragOffset(Math.min(maxOffset, Math.max(0, next)));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    dragStart.current = null;

    const released = dragOffset ?? start.offset;
    const travelled = released - start.offset;

    // A decisive flick moves one stop even when it did not cross the midpoint;
    // otherwise settle on whichever snap the sheet is physically closest to.
    const FLICK_PX = 48;
    let target: SheetSnap;

    if (Math.abs(travelled) > FLICK_PX) {
      const step = travelled > 0 ? -1 : 1; // dragging down shrinks the sheet
      const index = ORDER.indexOf(snap) + step;
      target = ORDER[Math.min(ORDER.length - 1, Math.max(0, index))];
    } else {
      target = ORDER.reduce((best, candidate) =>
        Math.abs(offsetFor(candidate) - released) < Math.abs(offsetFor(best) - released)
          ? candidate
          : best
      );
    }

    setDragOffset(null);
    onSnapChange(target);
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  };

  /** Tapping the grabber cycles up, then wraps back to peek from full. */
  const cycleSnap = () => {
    const index = ORDER.indexOf(snap);
    onSnapChange(index === ORDER.length - 1 ? 'peek' : ORDER[index + 1]);
  };

  return (
    <div
      ref={sheetRef}
      className="fixed inset-x-0 z-30 flex flex-col rounded-t-3xl border-t border-gray-200 bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.18)]"
      style={{
        bottom: 0,
        height: fullHeight,
        transform: `translateY(${currentOffset}px)`,
        // No transition mid-drag: the sheet must track the finger exactly.
        transition: dragOffset === null ? 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)' : 'none',
      }}
    >
      {/* Drag zone. `touch-action: none` stops the browser claiming the gesture
          for a page scroll before the pointer handlers ever see it. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="shrink-0 cursor-grab touch-none pt-2.5 pb-1 active:cursor-grabbing"
      >
        <button
          onClick={cycleSnap}
          aria-label={`Sheet is ${snap}. Tap to expand.`}
          className="mx-auto block h-1.5 w-11 rounded-full bg-gray-300 transition hover:bg-gray-400"
        />
      </div>

      {pinned && <div className="shrink-0 px-4 pb-2">{pinned}</div>}

      {/* The only scrollable region in the entire mobile layout. The bottom
          padding is the tab bar's height, so the last row can be scrolled clear
          of the floating pill instead of hiding under it. */}
      <div
        className="gt-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
        style={{ touchAction: 'pan-y', paddingBottom: bottomOffset + 16 }}
      >
        {children}
      </div>

      {/* Keeps the sheet from reading as a floating card when fully open. */}
      <span className="sr-only">Sheet height {Math.round(visibleHeight)} pixels</span>
    </div>
  );
};
