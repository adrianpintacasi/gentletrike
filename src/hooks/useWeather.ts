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

export function useWeather(): { weather: Weather | null; error: boolean } {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${DUMAGUETE.lat}&longitude=${DUMAGUETE.lng}` +
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
  }, []);

  return { weather, error };
}
