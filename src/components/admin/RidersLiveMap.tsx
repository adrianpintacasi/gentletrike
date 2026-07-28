import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface RiderPoint {
  id: string;
  name: string;
  unitNumber: string;
  lat: number;
  lng: number;
}

/** A lightweight live map of the riders currently online, for the TMO overview. */
export const RidersLiveMap: React.FC<{ riders: RiderPoint[] }> = ({ riders }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});

  // Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [9.3082, 123.3075],
      zoom: 14,
      zoomControl: false,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;

    const ro = new ResizeObserver(() => mapRef.current?.invalidateSize());
    ro.observe(containerRef.current);
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, []);

  // Sync markers whenever the online riders change (move, add, or drop off).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    riders.forEach((r) => {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return;
      seen.add(r.id);
      const icon = L.divIcon({
        className: 'gt-live-rider-pin',
        html: `
          <div class="relative flex flex-col items-center">
            <div class="w-9 h-9 bg-gray-900 text-amber-400 rounded-full shadow-lg border border-amber-400 flex items-center justify-center text-base">🛺</div>
            <div class="mt-0.5 bg-gray-900 text-amber-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap">${r.unitNumber}</div>
          </div>`,
        iconSize: [40, 48],
        iconAnchor: [20, 24],
      });

      const existing = markersRef.current[r.id];
      if (existing) {
        existing.setLatLng([r.lat, r.lng]).setIcon(icon);
      } else {
        markersRef.current[r.id] = L.marker([r.lat, r.lng], { icon })
          .addTo(map)
          .bindTooltip(`${r.name} · Unit ${r.unitNumber}`, { direction: 'top' });
      }
    });

    // Remove markers for riders who went offline.
    Object.keys(markersRef.current).forEach((id) => {
      if (!seen.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });
  }, [riders]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full z-0 bg-white rounded-xl overflow-hidden" />
      {riders.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="bg-white/90 px-4 py-2 rounded-xl text-xs font-bold text-gray-500 shadow border border-gray-200">
            No riders online right now
          </span>
        </div>
      )}
    </div>
  );
};
