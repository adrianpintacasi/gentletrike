import { useEffect, useRef } from 'react';

/**
 * Run `fn` immediately, then every `intervalMs`.
 *
 * Polling pauses while the tab is hidden — a driver's phone in their pocket
 * should not keep hammering the free-tier server — and fires once again the
 * moment it comes back so the queue is fresh on wake.
 *
 * Pass `enabled: false` to stop entirely.
 */
export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  enabled = true
) {
  const savedFn = useRef(fn);

  useEffect(() => {
    savedFn.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled || document.hidden) return;
      void savedFn.current();
    };

    const start = () => {
      if (timer !== null) return;
      tick();
      timer = setInterval(tick, intervalMs);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
