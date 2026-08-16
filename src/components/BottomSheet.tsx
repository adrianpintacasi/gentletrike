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
/*
 * Half and full are fractions of the screen. Peek is not.
 *
 * Peek was 0.26, chosen when the pinned row stacked four lines — so it was
 * always either wasting map or clipping content, and after that row was cut to
 * two it did both: a quarter of the screen reserved, with the floating tab bar
 * still landing on top of the row it was reserving space for.
 *
 * Peek is now measured. It is exactly the grabber, plus whatever the pinned row
 * actually is, plus the tab bar's height so the two never overlap. Nothing is
 * hidden and nothing is spare, whatever the pinned row happens to contain.
 */
const SNAP_FRACTIONS: Record<Exclude<SheetSnap, 'peek'>, number> = {
  half: 0.55,
  full: 0.9,
};

/** Height of the grabber strip above the content. */
const GRABBER_H = 36;

/**
 * How much content peek shows when there is no pinned row to measure.
 *
 * A fraction, because a tall phone should reveal more than a short one, with a
 * floor so it is never a sliver. This replaced a flat 132px that was applied at
 * every screen size — and 132 minus the grabber minus the tab bar left 22px of
 * usable sheet, which is why it read as broken rather than small.
 */
const PEEK_CONTENT_FRACTION = 0.24;
const MIN_PEEK_CONTENT = 104;

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
  /*
   * The drag is driven imperatively, not through state.
   *
   * It used to setState on every pointermove, which re-rendered the sheet and
   * everything inside it — the whole booking panel, or the whole rider queue —
   * sixty times a second. The finger outran React, so the sheet stuttered
   * mid-drag, and worse: pointerup read the offset from a render closure that
   * had not caught up, computed the wrong travel, and settled on the wrong
   * snap. That is why a drag upward sometimes fell straight back to peek.
   *
   * The live offset lives in a ref and is written straight to the transform.
   * React is told once, on release.
   */
  const offsetRef = React.useRef(0);
  const draggingRef = React.useRef(false);
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
  /**
   * The pinned row's real height, so peek can be exactly big enough.
   *
   * A ResizeObserver rather than a one-off measurement: the row changes shape as
   * a trip moves through its stages — offline, searching, driving to a pickup —
   * and each of those is a different height.
   */
  const pinnedRef = React.useRef<HTMLDivElement>(null);
  const [pinnedH, setPinnedH] = React.useState(0);

  // Layout effect, not effect: the first measurement has to land before paint,
  // or the sheet opens at the fallback height and visibly snaps to the real one.
  React.useLayoutEffect(() => {
    const el = pinnedRef.current;
    if (!el) return;
    setPinnedH(el.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setPinnedH(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pinned]);

  const available = viewportH;

  /*
   * Peek = the grabber, the content, and the tab bar's height.
   *
   * That last term is the part that was missing. The pill floats over the
   * sheet, so any peek that does not account for it is handing its bottom 84px
   * to something that covers them.
   */
  const peekContent = pinned
    ? pinnedH || MIN_PEEK_CONTENT
    : Math.max(MIN_PEEK_CONTENT, Math.round(PEEK_CONTENT_FRACTION * available));
  const peekHeight = Math.round(GRABBER_H + peekContent + bottomOffset + 8);

  const heightFor = (s: SheetSnap) =>
    s === 'peek' ? peekHeight : Math.round(SNAP_FRACTIONS[s] * available);
  const fullHeight = heightFor('full');

  /** How far the sheet is pushed down from its fully-open position. */
  const offsetFor = (s: SheetSnap) => fullHeight - heightFor(s);
  const maxOffset = offsetFor('peek');

  const settledOffset = offsetFor(snap);
  const visibleHeight = fullHeight - settledOffset;

  /** Write the sheet's position without going through React. */
  const applyOffset = (px: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate
      ? 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)'
      : 'none';
    el.style.transform = `translateY(${px}px)`;
    offsetRef.current = px;
  };

  // Settle wherever the snap says, whenever the snap or the geometry changes —
  // and never mid-drag, which would fight the finger.
  React.useLayoutEffect(() => {
    if (draggingRef.current) return;
    applyOffset(settledOffset, true);
  }, [settledOffset]);

  // Report only the settled height. Emitting on every drag frame would make the
  // map recompute its padding dozens of times a second for no visual gain.
  React.useEffect(() => {
    onHeightChange?.(visibleHeight + bottomOffset);
  }, [visibleHeight, bottomOffset, onHeightChange]);

  const beginDrag = (event: React.PointerEvent) => {
    // A press on a control is a press on that control. Without this, every
    // button in the sheet would swallow its own tap into a drag.
    if ((event.target as HTMLElement).closest('button,a,input,textarea,select')) return;
    if (dragStart.current) return; // ignore the second finger of a pinch

    dragStart.current = { y: event.clientY, offset: offsetRef.current };
    draggingRef.current = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerDown = beginDrag;

  /*
   * Dragging from the content, the way every native sheet works.
   *
   * The handle area is all a passenger had — they have no pinned row, so the
   * only draggable part of the whole sheet was a 32px strip, which is exactly
   * why the rider's sheet improved and theirs did not.
   *
   * A drag starts here only when the content is already scrolled to the top.
   * Below that, the gesture belongs to the list: pulling down on a
   * half-scrolled fare table should scroll it, not close the sheet.
   */
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const onContentPointerDown = (event: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    beginDrag(event);
  };

  const onContentPointerMove = (event: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const delta = event.clientY - start.y;

    // Pulling up from the top of a scrollable list is a scroll, not a drag —
    // hand it back the moment the intent is clear.
    const el = scrollRef.current;
    if (delta < 0 && el && el.scrollHeight > el.clientHeight && offsetRef.current <= 0) {
      dragStart.current = null;
      draggingRef.current = false;
      return;
    }
    onPointerMove(event);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const next = start.offset + (event.clientY - start.y);
    applyOffset(Math.min(maxOffset, Math.max(0, next)), false);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    dragStart.current = null;
    draggingRef.current = false;

    const released = offsetRef.current;
    const travelled = released - start.offset;

    // A decisive flick moves one stop even when it did not cross the midpoint;
    // otherwise settle on whichever snap the sheet is physically closest to.
    const FLICK_PX = 40;
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

    // Move now rather than waiting for the parent to echo the new snap back —
    // if the target equals the current snap, no prop changes and the layout
    // effect above never fires, leaving the sheet wherever the finger left it.
    applyOffset(offsetFor(target), true);
    onSnapChange(target);

    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* the pointer was already released */
    }
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
        // Position is written imperatively by applyOffset; this is only the
        // value React renders with before the layout effect runs.
        transform: `translateY(${settledOffset}px)`,
        // Its own compositor layer, so a drag frame composites rather than
        // repainting the sheet over a live map.
        willChange: 'transform',
      }}
    >
      {/* Drag zone. `touch-action: none` stops the browser claiming the gesture
          for a page scroll before the pointer handlers ever see it. */}
      {/* The grab area is the grabber and the pinned row together. A 32px strip
          was the only draggable part of a sheet several hundred pixels tall,
          which is what "hard to drag" meant. Presses that land on a control are
          let through to it — see onPointerDown. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
      >
        <div className="pb-2.5 pt-4">
        {/* The visible grabber is 6px tall; the target around it is the whole
            strip, because a 6px target on a moving vehicle is not a target. */}
          <button
            onClick={cycleSnap}
            aria-label={`Sheet is ${snap}. Tap to expand.`}
            className="mx-auto block h-1.5 w-12 rounded-full bg-gray-300 transition hover:bg-gray-400"
          />
        </div>

        {pinned && (
          <div ref={pinnedRef} className="px-5 pb-2 sm:px-6">
            {pinned}
          </div>
        )}
      </div>

      {/* The only scrollable region in the entire mobile layout. The bottom
          padding is the tab bar's height, so the last row can be scrolled clear
          of the floating pill instead of hiding under it. */}
      <div
        ref={scrollRef}
        onPointerDown={onContentPointerDown}
        onPointerMove={onContentPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="gt-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6"
        style={{ touchAction: 'pan-y', paddingBottom: bottomOffset + 16 }}
      >
        {children}
      </div>

      {/* Keeps the sheet from reading as a floating card when fully open. */}
      <span className="sr-only">Sheet height {Math.round(visibleHeight)} pixels</span>
    </div>
  );
};
