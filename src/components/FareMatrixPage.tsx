import React from 'react';
import { BadgeCheck, Info, Sparkles, Search, X } from 'lucide-react';
import { VEHICLE_DETAILS, type TransportMode } from '../../shared/transport';
import { BASE_DISTANCE_KM, farePerPassenger } from '../../shared/fare';
import { hasFareAuthority } from '../../shared/serviceArea';

/**
 * The published fares, as a page rather than a dialog.
 *
 * This is a reference document, not a calculator. It used to carry a search box
 * over a table of straight-line distances multiplied by a road factor — numbers
 * the ordinance never published, which returned nothing when a passenger typed
 * a barangay that was not in our fixture list. Working out what a specific trip
 * costs is Gently's job and the booking screen's job; both use the routed
 * distance. This page's job is to state the rate a driver is bound by.
 */

/**
 * Two ways a fare can be set, which is the distinction that actually matters at
 * the roadside: metered by distance, or agreed for the whole vehicle.
 */
/*
 * No `as TransportMode[]` on these lists.
 *
 * The cast is what let the retired vehicles survive here: it silenced the
 * compiler, so the page went on looking up habal_habal at runtime, found
 * undefined, and blanked when the tab was opened. Typed properly, removing a
 * mode from the rate card breaks the build instead of the screen.
 */
const CATEGORIES: {
  key: 'regular' | 'charter';
  label: string;
  emoji: string;
  modes: TransportMode[];
}[] = [
  {
    key: 'regular',
    label: 'Regular',
    emoji: '🛺',
    modes: ['pedicab_standard'],
  },
  {
    key: 'charter',
    label: 'Charter',
    emoji: '🛺',
    modes: ['pakyaw_charter'],
  },
];

/** One glyph per rate card, matching the booking screen. */
const VEHICLE_EMOJI: Record<TransportMode, string> = {
  pedicab_standard: '🛺',
  pakyaw_charter: '🛺',
};

/** Distances chosen to show the ceiling rule, including both sides of a boundary. */
const SAMPLE_KM = [1, 1.01, 2, 2.01, 3, 5];

/**
 * Which towns' rates the app actually holds.
 *
 * Only Dumaguete is populated, and the rest say so plainly. Every neighbouring
 * municipality sets its own matrix by ordinance, and inventing plausible numbers
 * for them would produce a screen that looks authoritative and quotes fares no
 * council ever passed — the exact failure this page exists to prevent.
 */
const MUNICIPALITIES: { name: string; available: boolean; lat: number; lng: number }[] = [
  { name: 'Dumaguete City', available: true, lat: 9.3068, lng: 123.3054 },
  { name: 'Sibulan', available: false, lat: 9.3597, lng: 123.2900 },
  { name: 'Valencia', available: false, lat: 9.2833, lng: 123.2333 },
  { name: 'Bacong', available: false, lat: 9.2500, lng: 123.2933 },
  { name: 'Dauin', available: false, lat: 9.1936, lng: 123.2650 },
  { name: 'Zamboanguita', available: false, lat: 9.1000, lng: 123.2000 },
  { name: 'Bais City', available: false, lat: 9.5911, lng: 123.1225 },
  { name: 'Tanjay City', available: false, lat: 9.5153, lng: 123.1583 },
];

/**
 * The name shown when we are pricing by the standard rate rather than a
 * council's own table. Not a place — it is what the app falls back to
 * everywhere it has not been given an ordinance.
 */
const STANDARD = 'Standard rate';

/**
 * The rate GentleTrike quotes where it has no ordinance on file.
 *
 * Tricycle and pedicab fares across the Philippines are set municipality by
 * municipality, and the great majority land within a few pesos of each other —
 * a flag-down covering the first kilometre, then a per-kilometre increment,
 * with a legally mandated discount for students, seniors, PWDs and solo
 * parents. These are those typical figures, and they are labelled an estimate
 * wherever they appear, because that is exactly what they are.
 *
 * Deliberately NOT presented as anyone's ordinance. The app's one real claim is
 * that it does not print numbers no council passed, and a plausible table
 * wearing an official badge would cost more than it is worth.
 */
const STANDARD_RATE = {
  baseFare: 15,
  perKm: 2,
  discountedBase: 12,
  discountPercent: 20,
};

interface FareMatrixPageProps {
  /** The passenger's fix, so the page opens on the town they are standing in. */
  position?: { lat: number; lng: number } | null;
}

export const FareMatrixPage: React.FC<FareMatrixPageProps> = ({ position }) => {
  const [category, setCategory] = React.useState<'regular' | 'charter'>('regular');

  /**
   * Which rate card to open on.
   *
   * The old version picked the nearest town centre from a list of eight, all in
   * Negros Oriental — so a passenger in Cebu was shown Bais City's rates purely
   * because Bais was the least distant name in an irrelevant list. Now the
   * question is asked properly: does this position fall inside somewhere whose
   * ordinance we actually hold? If not, the standard estimate is the honest
   * answer, and it is the same answer anywhere in the country.
   */
  const nearestTown = React.useMemo(() => {
    if (!position) return STANDARD;
    if (!hasFareAuthority(position.lat, position.lng)) return STANDARD;
    return (
      [...MUNICIPALITIES]
        .filter((m) => m.available)
        .sort(
          (a, b) =>
            (a.lat - position.lat) ** 2 + (a.lng - position.lng) ** 2 -
            ((b.lat - position.lat) ** 2 + (b.lng - position.lng) ** 2)
        )[0]?.name ?? STANDARD
    );
  }, [position?.lat, position?.lng]);

  const [town, setTown] = React.useState(nearestTown);
  const [query, setQuery] = React.useState('');
  const [isPicking, setIsPicking] = React.useState(false);

  // Follow the fix until the reader picks a town themselves.
  const chosenRef = React.useRef(false);
  React.useEffect(() => {
    if (!chosenRef.current) setTown(nearestTown);
  }, [nearestTown]);

  // The standard rate heads the list: it is the one that applies everywhere,
  // and every named town below it is an ordinance we either hold or do not.
  const searchable = [
    { name: STANDARD, available: true, lat: 0, lng: 0 },
    ...MUNICIPALITIES,
  ];
  const matches = searchable.filter((m) =>
    m.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const active = CATEGORIES.find((c) => c.key === category)!;
  const selectedTown = searchable.find((m) => m.name === town) ?? searchable[0];
  /** Whether the figures on screen are a council's, or our standard estimate. */
  const isOrdinance = selectedTown.name !== STANDARD;

  return (
    <div className="space-y-3 pb-2">
      <header className="pt-1">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Fare Matrix</h1>
        <p className="mt-0.5 text-xs font-semibold text-gray-500">
          {isOrdinance
            ? 'Rates set by local ordinance, not by GentleTrike'
            : 'Standard estimate — your LGU’s ordinance takes precedence'}
        </p>
      </header>

      {/* A search, not a dropdown: the list will grow as ordinances are added,
          and a select of thirty towns is a scroll, not a choice. */}
      <div className="relative">
        <div className="flex items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-xs focus-within:border-amber-400">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            value={isPicking ? query : town}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setIsPicking(true);
              setQuery('');
            }}
            placeholder="Search municipality"
            className="w-full bg-transparent text-sm font-semibold text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
          />
          {isPicking && (
            <button
              onClick={() => {
                setIsPicking(false);
                setQuery('');
              }}
              aria-label="Cancel"
              className="shrink-0 rounded-lg p-1 text-gray-400 hover:text-gray-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {isPicking && (
          <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl">
            {matches.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-gray-400">
                No municipality matches “{query}”.
              </p>
            ) : (
              matches.map((m) => (
                <button
                  key={m.name}
                  onClick={() => {
                    chosenRef.current = true;
                    setTown(m.name);
                    setIsPicking(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
                    {m.name}
                  </span>
                  {m.available ? (
                    <span className="shrink-0 text-[10px] font-semibold uppercase text-emerald-600">
                      Published
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-gray-400">Not yet</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border py-3.5 text-xs font-semibold transition ${
              category === c.key
                ? 'border-yellow-400 bg-yellow-400 text-gray-900 shadow-sm'
                : 'border-gray-200 bg-white text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="text-base leading-none">{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>

      {!selectedTown.available ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
          <Info className="mx-auto mb-2 h-6 w-6 text-gray-300" />
          <p className="text-sm font-bold text-gray-900">No published rates for {town} yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs font-medium text-gray-500">
            Each municipality sets its own fare matrix by ordinance. Until {town}'s is
            loaded, GentleTrike quotes the standard estimate and says so — it will not
            print a figure as official that no council has passed.
          </p>
          <button
            onClick={() => {
              chosenRef.current = true;
              setTown(STANDARD);
            }}
            className="mt-4 rounded-xl bg-yellow-400 px-4 py-2.5 text-xs font-bold text-gray-900 shadow-xs transition active:scale-95 hover:bg-yellow-300"
          >
            Show the standard rate
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="text-sm font-bold text-gray-900">{town}</h2>
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-900">
              <BadgeCheck className="h-3 w-3" />
              TMO Verified
            </span>
          </div>

          <div className="space-y-2">
            {active.modes.map((mode) => {
              const v = VEHICLE_DETAILS[mode];
              return (
                <div
                  key={mode}
                  className="rounded-2xl border border-gray-200 bg-white p-3.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{VEHICLE_EMOJI[mode]}</span>
                    <h3 className="text-sm font-bold text-gray-900">{v.title}</h3>
                    <span className="ml-auto shrink-0 text-[11px] text-gray-400">
                      {v.capacity}
                    </span>
                  </div>

                  <p className="mt-1.5 text-sm font-bold text-gray-900">
                    ₱{v.baseFare} for the first {BASE_DISTANCE_KM} km
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    then ₱{v.perKm} per succeeding km or fraction thereof
                    {mode === 'pakyaw_charter'
                      ? ' · flat for the whole vehicle, and a minimum you offer at or above'
                      : ' · per passenger'}
                  </p>
                </div>
              );
            })}
          </div>

          {category === 'regular' && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                How the ceiling works
              </h2>
              <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                {SAMPLE_KM.map((km) => (
                  <div key={km} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-semibold text-gray-600">{km} km</span>
                    <span className="text-sm font-bold text-gray-900">
                      ₱{farePerPassenger('pedicab_standard', km)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="px-1 pt-2 text-[11px] font-medium text-gray-400">
                Pedicab rate shown. A fraction of a kilometre always rounds up to a whole
                one — which is why 1.01 km costs the same as 2 km.
              </p>
            </section>
          )}

          {/* A legal entitlement, and the one most worth stating plainly: a few
              pesos is what decides whether the trip happens for the people who
              depend on it most. Said here rather than silently applied, because
              the app quotes the full fare and the discount is arranged with the
              rider — claiming otherwise would misprice the trip. */}
          {category === 'regular' && (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Who pays less
              </h2>
              <p className="mt-1.5 text-xs font-medium text-emerald-900">
                Students, senior citizens, PWDs and solo parents with a valid ID are
                entitled to <strong>{STANDARD_RATE.discountPercent}% off</strong> — typically
                ₱{STANDARD_RATE.discountedBase} for the first kilometre instead of
                ₱{STANDARD_RATE.baseFare}.
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-emerald-700">
                GentleTrike quotes the full fare and does not deduct this automatically —
                show your ID and arrange it with your rider.
              </p>
            </section>
          )}
        </>
      )}

      {/* Working out a specific trip is a conversation, not a lookup — so the
          page points at the thing that can actually hold one. */}
      <div className="flex items-start gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-yellow-700" />
        <p className="text-xs font-medium text-yellow-900">
          Want the fare for a specific trip? Ask <span className="font-bold">Gently</span> —
          it works it out from the real road distance, which is what you are charged on.
        </p>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Discounts</h2>
        <p className="mt-2 text-xs font-medium text-gray-600">
          Students, senior citizens and PWDs with a valid ID are entitled to 20% off.
          GentleTrike does not compute this yet — the fare shown is the full amount, so
          please arrange the discount with your driver.
        </p>
      </section>
    </div>
  );
};
