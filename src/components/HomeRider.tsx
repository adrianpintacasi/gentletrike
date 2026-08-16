import React from 'react';
import { Star, Route, CloudRain } from 'lucide-react';
import type { Driver } from '../types';
import type { TodayTotals } from '../api';
import { vehicleDetail } from '../../shared/transport';
import { useWeather, describeWeather } from '../hooks/useWeather';

/**
 * The rider's instrument strip.
 *
 * This was a home screen: a greeting, a 160px hero card holding one emoji, a
 * duty toggle, and four stat tiles — most of a phone screen spent on things a
 * rider reads once a day, sitting above the queue they actually opened the app
 * for. Worse, it carried a second duty toggle and a second earnings figure, so
 * the same two facts appeared twice on one screen and disagreed.
 *
 * It is now a strip. One line of numbers, read at a glance, over the map rather
 * than instead of it — because everything below it is the job.
 *
 * Dark, unlike every passenger surface in the app. Not decoration: a rider
 * works at night and in glare, holds the phone at arm's length on a mount, and
 * looks at it for well under a second at a time. Dark ground with one bright
 * figure survives that; a white card with grey captions does not. It also means
 * a glance tells you which mode you are in before you have read a word.
 */

interface HomeRiderProps {
  driver: Driver;
  today: TodayTotals | null;
  /** Where the rider is, so the forecast is theirs and not a fixed city's. */
  position?: { lat: number; lng: number } | null;
}

export const HomeRider: React.FC<HomeRiderProps> = ({ driver, today, position }) => {
  const { weather } = useWeather(position);
  const sky = weather ? describeWeather(weather.code) : null;
  const vehicle = vehicleDetail(driver.vehicleType);

  /*
   * Every figure here comes from `/me/today`, which derives them from completed
   * trips. `drivers.earnings_today` is incremented on completion and never
   * reset, so it had quietly become a career total wearing the word "today" —
   * and the two were displayed side by side, disagreeing, on this very screen.
   */
  const earnings = today?.driver.earnings ?? 0;
  const trips = today?.driver.trips ?? 0;
  const distanceKm = today?.driver.distanceKm ?? 0;

  return (
    <div className="overflow-hidden rounded-2xl bg-gray-900 text-white shadow-lg">
      <div className="flex items-stretch">
        {/* The one number worth a glance. Everything else is context for it. */}
        <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
            Earned today
          </p>
          <p className="mt-0.5 text-3xl font-bold leading-none tracking-tight text-amber-400 tabular-nums">
            ₱{earnings}
          </p>
        </div>

        {/* A hairline rather than a gap: this is one instrument, not two cards. */}
        <div className="my-3 w-px shrink-0 bg-white/10" />

        <div className="flex shrink-0 flex-col justify-center gap-1.5 px-4 py-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300 tabular-nums">
            <Route className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            {trips} trips · {distanceKm} km
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300 tabular-nums">
            <Star className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            {driver.rating} rating
          </span>
          {weather && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300 tabular-nums">
              <CloudRain className="h-3.5 w-3.5 shrink-0 text-gray-500" />
              {weather.temperature}°C · {weather.rainChance}% rain
            </span>
          )}
        </div>
      </div>

      {/* Which unit is on duty. Small, because it never changes — but present,
          because a rider driving someone else's trike needs to see it is the
          right one before they accept work against it. */}
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2">
        <span className="text-sm leading-none" role="img" aria-label={vehicle.title}>
          🛺
        </span>
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-gray-400">
          {vehicle.title} · {driver.unitNumber}
        </p>
        {sky && (
          <span className="shrink-0 text-[11px] font-semibold text-gray-500">{sky.label}</span>
        )}
      </div>
    </div>
  );
};
