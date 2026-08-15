import { useCallback, useEffect, useState } from 'react';

/**
 * Light or dark, remembered between visits.
 *
 * The choice is stored and applied as a `dark` class on <html>, which is what
 * Tailwind's `dark:` variants key off. Defaults to the device preference so a
 * phone already in dark mode does not open a white screen at night.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'gentletrike:theme';

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = readStored();
    if (stored) return stored;
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const change = useCallback((next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private browsing — session only */
    }
  }, []);

  return [theme, change];
}
