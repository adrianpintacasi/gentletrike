import { useEffect, useState } from 'react';

/**
 * Track a CSS media query from JavaScript.
 *
 * The mobile shell and the desktop two-column layout render *different* trees
 * rather than the same tree hidden with CSS, because hiding one with `lg:hidden`
 * would still mount it: two DriverModePanels means two polling loops, two unread
 * -message subscriptions, and two chat threads racing each other.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    // Re-read on mount: the viewport can change between first render and effect.
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Matches Tailwind's `lg` breakpoint, which is where the sidebar layout fits. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)');
