import { useEffect, useState } from 'react';

/**
 * Dumaguete's current weather, from Open-Meteo.
 *
 * Chosen because it needs no API key and no billing account — one more Google
 * SKU for a number on a home screen is not a trade worth making, and a rider
 * checking whether it is about to rain should not be a metered call.
 *
 * Rain matters here beyond decoration: a pedicab in a Dumaguete downpour is a
 * different job, and it is why demand spikes.
 */

const DUMAGUETE = { lat: 9.3068, lng: 123.3054 };

/** Refetch hourly. The forecast does not change faster than that. */
const REFRESH_MS = 60 * 60 * 1000;

export interface Weather {
  temperature: number;
  /** WMO weather code — see `describeWeather`. */
  code: number;
  isDay: boolean;
  high: number;
  low: number;
  /** Chance of rain today, as a percentage. */
  rainChance: number;
}

/**
 * WMO weather codes, collapsed to the handful that actually differ on screen.
 * The full table has 28 entries and Dumaguete realistically sees six of them.
 */
export function describeWeather(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: '☀️' };
  if (code <= 2) return { label: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { label: 'Cloudy', icon: '☁️' };
  if (code <= 48) return { label: 'Foggy', icon: '🌫️' };
  if (code <= 57) return { label: 'Drizzle', icon: '🌦️' };
  if (code <= 67) return { label: 'Rain', icon: '🌧️' };
  if (code <= 82) return { label: 'Showers', icon: '🌧️' };
  if (code <= 99) return { label: 'Thunderstorm', icon: '⛈️' };
  return { label: 'Unsettled', icon: '🌤️' };
}

/**
 * The forecast where the passenger actually is.
 *
 * This was pinned to Dumaguete's coordinates, which was fine while the app went
 * no further — and became wrong the moment it did. Someone standing in Cebu was
 * shown the temperature 250 km away, under a label naming a city they were not
 * in. Rain matters to a passenger deciding whether to wait by the road, so the
 * one thing it must be is local.
 *
 * Falls back to Dumaguete only when there is no fix yet.
 */
export function useWeather(position?: { lat: number; lng: number } | null): {
  weather: Weather | null;
  error: boolean;
} {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState(false);

  // Rounded, so a GPS watch that reports every second does not refetch the
  // forecast every second. Two decimals is ~1 km — far finer than the model's
  // own grid, and stable while somebody stands still.
  const lat = position ? Number(position.lat.toFixed(2)) : DUMAGUETE.lat;
  const lng = position ? Number(position.lng.toFixed(2)) : DUMAGUETE.lng;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&current=temperature_2m,weather_code,is_day` +
          `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&timezone=Asia%2FManila&forecast_days=1`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(String(response.status));

        const data = await response.json();
        if (cancelled) return;

        setWeather({
          temperature: Math.round(data?.current?.temperature_2m ?? 0),
          code: Number(data?.current?.weather_code ?? 0),
          isDay: data?.current?.is_day === 1,
          high: Math.round(data?.daily?.temperature_2m_max?.[0] ?? 0),
          low: Math.round(data?.daily?.temperature_2m_min?.[0] ?? 0),
          rainChance: Math.round(data?.daily?.precipitation_probability_max?.[0] ?? 0),
        });
        setError(false);
      } catch {
        // A missing weather card is a cosmetic loss; the home screen still works.
        if (!cancelled) setError(true);
      }
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lat, lng]);

  return { weather, error };
}
