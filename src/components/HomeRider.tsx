import React from 'react';
import { Power, Wallet, Route, TrendingUp, Star } from 'lucide-react';
import type { Driver } from '../types';
import type { TodayTotals } from '../api';
import { VEHICLE_DETAILS , vehicleDetail } from '../../shared/transport';
import { useWeather, describeWeather } from '../hooks/useWeather';

/**
 * The rider's home screen.
 *
 * Laid out like the reference: a greeting, the unit they are driving, a hero
 * image of it, then a grid of the things worth knowing before setting off.
 *
 * The numbers come from `/me/today`, which derives them from completed trips
 * rather than reading `drivers.earnings_today` — that column is incremented on
 * every trip and never reset, so it had quietly become a career total labelled
 * "today".
 */

interface HomeRiderProps {
  driver: Driver;
  today: TodayTotals | null;
  onToggleOnline: (online: boolean) => void;
  onGoToQueue: () => void;
}

/**
 * Stand-ins until real unit photography exists.
 *
 * Deliberately per vehicle type rather than one generic trike: a habal-habal
 * rider opening the app to a picture of a pedicab learns immediately that the
 * screen is not really about them.
 */
const VEHICLE_ART: Record<string, string> = {
  pedicab_standard: '🛺',
  pakyaw_charter: '🚐',
};

export const HomeRider: React.FC<HomeRiderProps> = ({
  driver,
  today,
  onToggleOnline,
  onGoToQueue,
}) => {
  const { weather } = useWeather();
  const vehicle = vehicleDetail(driver.vehicleType);
  const sky = weather ? describeWeather(weather.code) : null;

  const earnings = today?.driver.earnings ?? 0;
  const trips = today?.driver.trips ?? 0;
  const distanceKm = today?.driver.distanceKm ?? 0;

  return (
    <div className="space-y-4 pb-2">
      <header className="pt-1">
        <p className="text-xs font-semibold text-gray-500">Ready to have a ride today?</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900">
          {vehicle?.title ?? 'Your unit'}
        </h1>
        <p className="mt-0.5 text-xs font-bold text-gray-400">
          {driver.unitNumber}
        </p>
      </header>

      {/* Hero. A placeholder until unit photos exist — sized and framed as the
          real image will be, so dropping one in changes nothing else. */}
      <div className="flex h-40 items-center justify-center rounded-3xl border border-gray-200 bg-gradient-to-b from-amber-50 to-white shadow-xs">
        <span className="text-7xl drop-shadow-md" role="img" aria-label={vehicle?.title}>
          {VEHICLE_ART[driver.vehicleType] ?? '🛺'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Duty status is the biggest control on the screen: it is the one thing
            a rider opens this app to change. */}
        <button
          onClick={() => onToggleOnline(!driver.isOnline)}
          className={`col-span-2 flex items-center gap-3 rounded-2xl p-4 text-left shadow-sm transition active:scale-[0.99] ${
            driver.isOnline
              ? 'bg-emerald-600 text-white'
              : 'border border-rose-200 bg-rose-50 text-rose-950'
          }`}
        >
          <Power className="h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">
              {driver.isOnline ? 'You are ONLINE' : 'You are OFFLINE'}
            </p>
            <p
              className={`truncate text-[11px] font-semibold ${
                driver.isOnline ? 'text-emerald-100' : 'text-rose-700'
              }`}
            >
              {driver.isOnline ? 'Receiving trip requests' : 'Tap to start receiving trips'}
            </p>
          </div>
        </button>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <Wallet className="mb-2 h-5 w-5 text-amber-600" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Earned today
          </p>
          <p className="mt-0.5 text-2xl font-bold leading-none text-gray-900">₱{earnings}</p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <Route className="mb-2 h-5 w-5 text-amber-600" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Trips today
          </p>
          <p className="mt-0.5 text-2xl font-bold leading-none text-gray-900">{trips}</p>
          <p className="mt-1 text-[11px] font-semibold text-gray-400">{distanceKm} km driven</p>
        </div>

        {/* Rain is not decoration here: a downpour changes both the job and the
            demand, so it earns a card rather than a line of small print. */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <p className="mb-1 text-2xl leading-none">{sky?.icon ?? '🌤️'}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Dumaguete</p>
          <p className="mt-0.5 text-2xl font-bold leading-none text-gray-900">
            {weather ? `${weather.temperature}°C` : '—'}
          </p>
          <p className="mt-1 truncate text-[11px] font-semibold text-gray-400">
            {weather ? `${sky?.label} · ${weather.rainChance}% rain` : 'Weather unavailable'}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <Star className="mb-2 h-5 w-5 text-amber-600" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Rating</p>
          <p className="mt-0.5 text-2xl font-bold leading-none text-gray-900">{driver.rating}</p>
          <p className="mt-1 text-[11px] font-semibold text-gray-400">
            {driver.tripsCompleted} trips all time
          </p>
        </div>
      </div>

      <button
        onClick={onGoToQueue}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 py-4 text-sm font-semibold text-amber-400 shadow-sm transition active:scale-[0.99] hover:bg-gray-800"
      >
        <TrendingUp className="h-4 w-4" />
        Open trip queue
      </button>
    </div>
  );
};
