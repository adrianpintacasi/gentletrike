import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';

/**
 * Unread message counts per trip, for the chat badge.
 *
 * Both screens previously polled the thread only while the chat panel was
 * open, which made a notification impossible: nothing was listening when the
 * panel was closed, so a message could arrive and never be announced. This
 * polls in the background and counts anything from the other party since the
 * last time that thread was actually looked at.
 *
 * Threads are short and a rider carries a handful of trips, so fetching each is
 * cheap. The interval is deliberately slower than the ride polling — a chat
 * badge a few seconds late is fine, a doubled request rate is not.
 */
export function useUnreadMessages(
  rideIds: string[],
  /** Which sender is "me" — messages from me are never unread. */
  mySender: 'user' | 'driver',
  pollMs = 5000
) {
  const [unread, setUnread] = useState<Record<string, number>>({});

  /** Newest message id already seen per trip. */
  const seen = useRef<Record<string, string>>({});

  // Keyed so the effect restarts when the set of trips changes, not on every
  // render that happens to rebuild the array.
  const key = rideIds.join(',');

  const refresh = useCallback(async () => {
    if (!rideIds.length) {
      setUnread({});
      return;
    }

    const counts: Record<string, number> = {};

    await Promise.all(
      rideIds.map(async (rideId) => {
        try {
          const rows = await api.listMessages(rideId);
          const lastSeen = seen.current[rideId];

          // Everything after the last id this trip was opened at. A thread
          // never opened counts every message from the other party.
          const startAt = lastSeen ? rows.findIndex((m) => m.id === lastSeen) + 1 : 0;
          counts[rideId] = rows
            .slice(startAt)
            .filter((m) => m.sender !== mySender && m.sender !== 'system').length;
        } catch {
          counts[rideId] = unread[rideId] ?? 0;
        }
      })
    );

    setUnread(counts);
  }, [key, mySender]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rideIds.length) return;

    void refresh();
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [key, pollMs, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Call when the rider or passenger opens a thread. */
  const markRead = useCallback(async (rideId: string) => {
    try {
      const rows = await api.listMessages(rideId);
      if (rows.length) seen.current[rideId] = rows[rows.length - 1].id;
    } catch {
      /* leave the badge up rather than clearing it on a failed read */
    }
    setUnread((prev) => ({ ...prev, [rideId]: 0 }));
  }, []);

  return { unread, markRead, refresh };
}
