# GentleTrike — Project Notes

A working reference for what this project is, how it fits together, and the
decisions behind it. For setup and deploy steps see [README.md](README.md);
this document explains the *why*.

---

## 1. What it is

GentleTrike is a real-time public-transport hailing app for **Dumaguete City**
(the "City of Gentle People", Negros Oriental, Philippines). It targets the
local pedicab / motorcab, habal-habal and multicab trades.

The core loop is genuinely multi-user:

- A **passenger** books a trip.
- A **rider** (driver), on duty on their own device, sees that request appear
  in a shared queue and accepts it.
- Both then watch the same trip progress live — the rider drives it through its
  stages, the passenger tracks the pedicab on a map, and either can chat.

Two phones, one server: what one person does, the other sees within a couple of
seconds.

**Live URL:** https://gentletrike.onrender.com (free tier — sleeps after ~15 min
idle, first hit takes ~50s to wake).

---

## 2. Tech stack

| Layer | Choice | Notes |
| ----- | ------ | ----- |
| Frontend | React 19 + TypeScript + Vite | SPA |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) | emits `oklch()` colours |
| Map | Leaflet + CartoDB Positron tiles | no API key needed |
| Routing | OSRM public server | real road geometry + distance |
| Backend | Express (Node) | one process serves API **and** the built SPA |
| Database | **Neon Postgres** via `pg` | cloud Postgres; persists + shared across the team |
| AI guide | Google Gemini (`@google/genai`) | optional; falls back to canned answers |
| Dev / build | tsx (dev), esbuild + Vite (prod) | |
| Host | Render (free plan) | auto-deploys on push to `main` |

### Database: from `node:sqlite` to Neon Postgres

The app first used **`node:sqlite`** (SQLite built into Node 24) — zero
dependencies, no compiler. It worked, but on the free host the SQLite *file* was
wiped on every restart, so accounts and rides couldn't survive and each machine
had its own separate copy. The app now uses **Neon Postgres** (managed cloud
database) via the **`pg`** driver: data persists across restarts and the whole
team + the live site share one database.

`pg` is **pure JavaScript**, so it still installs with no native build step. The
connection is in `DATABASE_URL` (`.env` locally, Render env in production). The
SQLite→Postgres differences are handled centrally in [server/db.ts](server/db.ts):
a tiny translator maps `?` placeholders to `$1,$2…` and `datetime('now')` to a
UTC text timestamp, `tx()` uses a pooled client tracked with AsyncLocalStorage,
and the query helpers are async.

> **Rule for this project:** never reintroduce a native/compiled dependency
> without a confirmed Windows prebuild. Prefer built-in or pure-JS packages
> (`pg` qualifies).

---

## 3. How the pieces fit

```
  Passenger phone                 Rider phone
        │                              │
        │  POST /api/rides             │  GET  /api/rides/open
        │  GET  /api/rides/:id  (poll) │  POST /api/rides/:id/accept
        │  GET  /messages       (poll) │  POST /api/rides/:id/status
        │                              │  PATCH /api/drivers/:id  ← live GPS
        └──────────►  Express + Neon Postgres  ◄──────────┘
                     (also serves the built SPA)
```

### Real-time by polling, not WebSockets

Clients **poll** the server on a timer rather than holding a socket:

- Passenger polls their active ride every **2.5 s**.
- Rider polls the open queue + their trips every **3 s**.
- Chat polls every **3 s** while the chat panel is open.

Polling is a few lines instead of a reconnection state machine, survives phone
sleep and flaky campus Wi-Fi, and at demo scale the load is trivial. Polling
**pauses while a browser tab is hidden** (see `usePolling`), so a phone in a
pocket does not keep hammering the free-tier server.

### No accounts — device identity

There is no login. Each browser generates a UUID into `localStorage`
(`CLIENT_ID` in `src/api.ts`). That id is how:

- a passenger reclaims their own in-flight ride after a reload, and
- a rider keeps hold of the same pedicab unit across reloads
  ("claiming" a unit = taking an unclaimed row in `drivers`).

---

## 4. Project layout

| Path | Responsibility |
| ---- | -------------- |
| [server.ts](server.ts) | Express entry; Vite middleware in dev, static `dist/` in prod; Gemini endpoint |
| [server/db.ts](server/db.ts) | Postgres (`pg`) pool, schema, fleet seed, async query helpers, row→JSON mapping |
| [server/routes.ts](server/routes.ts) | the `/api` surface |
| [src/api.ts](src/api.ts) | typed client for the API + the device id |
| [src/hooks/usePolling.ts](src/hooks/usePolling.ts) | visibility-aware polling hook |
| [src/App.tsx](src/App.tsx) | all app state; passenger and rider flows |
| [src/components/DumagueteMap.tsx](src/components/DumagueteMap.tsx) | Leaflet map, markers, route line, rider compass arrow |
| [src/components/RideBookingPanel.tsx](src/components/RideBookingPanel.tsx) | booking form, location search, fare preview |
| [src/components/ActiveRideView.tsx](src/components/ActiveRideView.tsx) | passenger's live-trip panel + chat |
| [src/components/DriverModePanel.tsx](src/components/DriverModePanel.tsx) | rider queue, accept/decline, stage controls |
| [src/components/RideCompleteModal.tsx](src/components/RideCompleteModal.tsx) | post-trip rating + report prompt |
| [src/components/GentleAiAssistant.tsx](src/components/GentleAiAssistant.tsx) | "Gently" chat modal |
| [src/components/FareMatrixModal.tsx](src/components/FareMatrixModal.tsx) | fare ordinance reference |
| [src/components/TmoReportModal.tsx](src/components/TmoReportModal.tsx) | TMO complaint form |
| [src/utils/dumagueteRouting.ts](src/utils/dumagueteRouting.ts) | OSRM routing, distance, bearing, offline fallback |
| [src/utils/fare.ts](src/utils/fare.ts) | fare calculation (ordinance rule) |
| [src/data/dumagueteData.ts](src/data/dumagueteData.ts) | landmarks, seed fleet, vehicle rate table |

---

## 5. The API

| Method | Route | Purpose |
| ------ | ----- | ------- |
| GET | `/api/health` | health check (used by Render) |
| GET | `/api/drivers` | fleet; `?online=1` for on-duty only |
| POST | `/api/drivers/claim` | take a pedicab unit for this device |
| GET | `/api/drivers/:id` | one driver |
| PATCH | `/api/drivers/:id` | push GPS position / duty status |
| GET | `/api/drivers/:id/rides` | that rider's live/pooled trips |
| POST | `/api/rides` | book a trip |
| GET | `/api/rides/open` | unclaimed requests for a rider (minus their declines) |
| GET | `/api/passengers/:id/rides` | a passenger's own live rides |
| GET | `/api/rides/:id` | poll one trip |
| POST | `/api/rides/:id/accept` | claim a trip (**first request wins**) |
| POST | `/api/rides/:id/decline` | hide it from this rider only |
| POST | `/api/rides/:id/status` | advance the trip stage |
| POST | `/api/rides/:id/cancel` | cancel |
| GET / POST | `/api/rides/:id/messages` | in-trip chat |
| POST | `/api/rides/:id/rating` | rate a completed trip (1–5) |
| POST | `/api/tmo-reports` | file a TMO complaint, returns a reference code |
| POST | `/api/dumaguete/ai-assistant` | ask "Gently" (Gemini or offline fallback) |

### Database tables

`drivers`, `rides`, `ride_declines`, `messages`, `ratings`, `tmo_reports`.
Postgres handles concurrent reads during writes natively (MVCC), so a
passenger's poll never blocks on a rider's write.

---

## 6. Key design decisions

### Ride acceptance is race-safe

Two riders can tap **Accept** on the same request at the same instant. The
accept is settled *in the database*, not in the app:

```sql
UPDATE rides SET driver_id = ?, status = 'driver_assigned'
 WHERE id = ? AND driver_id IS NULL AND status = 'searching_driver';
```

Only the first request to land finds `driver_id` still `NULL`. The second
matches zero rows and gets a **409** with a clear message, instead of silently
stealing the trip.

### Decline is per-rider

Declining inserts a row in `ride_declines(ride_id, driver_id)`. That hides the
request from **that one rider's** queue only — it stays open for everyone else.

### Distance and fare follow the *road*, not the crow

- Distance comes from **OSRM's real driving route**, not the straight line.
  Measured across six common Dumaguete routes, the road runs on average
  **1.32×** longer than straight-line. Charging on straight-line distance
  undercharged every trip.
- If OSRM is unreachable, the app falls back to straight-line × 1.32 and labels
  the figure `(approx)` rather than silently showing a wrong number.
- **Fare rule** (Dumaguete ordinance): ₱15 for the first km or less, then **₱2
  per succeeding km *or fraction thereof*** — a ceiling, not a proportion. So
  1.01 km already owes ₱17, and 2.00 km is still ₱17. Distance is rounded to
  10 m precision so a trip just past a kilometre boundary isn't rounded back
  under it. Fare is **never** ML-estimated — the ordinance sets it.

### The map only shows what's relevant

- **Unbooked passengers see no roaming pedicabs.** Only the rider who has
  actually accepted *their* booking appears — the map never implies a nearby
  trike the passenger has not been matched with.
- Pickup is **green**, destination is **red**, on both the passenger and rider
  maps (aligned so two people on one trip read the map the same way).
- **Route follows the trip stage:** searching → radar pulse over the pickup;
  accepted → route drawn from the rider to the pickup; on board → route redrawn
  to the destination pinned at booking.

### The rider's arrow is a real compass

The rider's own marker is a Waze/Google-Maps-style navigation chevron (solid
black). It rotates from the **device-orientation sensor** in real time, so it
points where the phone faces even while standing still — GPS heading is only the
fallback. Rotation is applied imperatively (no React re-render per sensor tick),
takes the shortest signed turn (never spins the long way), and ignores
sub-degree jitter. iOS motion permission is requested on the rider-mode tap.
**This only works on a real phone over HTTPS** — a laptop has no compass.

---

## 7. Deploying and iterating

### Local development

```bash
npm.cmd run dev        # PowerShell: use npm.cmd, or plain `npm run dev` in cmd
```
Open http://localhost:3000. Two windows (one **incognito**) act as two separate
people. GPS works on `localhost`; the **compass does not** (needs a phone).

### Deploy

`render.yaml` is a Blueprint configured for the free plan. Auto-deploy is **on**,
so **every push to `main` triggers a ~3–5 min build**. The workflow that matters:

```bash
git add <files>
git commit -m "..."    # push only sends COMMITS — an unsaved edit is invisible to it
git push
```

After a deploy, **hard-refresh** the site (`Ctrl+Shift+R`) — browsers cache the
old JS bundle.

### Free-tier caveats (fine for a demo)

- Sleeps after ~15 min idle; first hit ~50s to wake. Open it a minute early.
- Data lives in **Neon Postgres**, not on the server's disk, so rides and driver
  stats **survive** restarts and redeploys. (Render's own filesystem is still
  ephemeral, but the app no longer stores anything there.)

---

## 8. Known gaps / future ideas

- **No type safety at the React layer.** The project ships without
  `@types/react` and with `strict`/`noImplicitAny` **off**, so `tsc` passes but
  React props, hooks and JSX are all `any`. Turning strictness on surfaces
  ~960 implicit-`any` spots to clean up — a deliberate task, not a quick toggle.
  (This is also why VS Code can show stale "errors" that a **Restart TS Server**
  clears.)
- **ETA is a formula, not learned.** It uses OSRM's duration (or
  distance ÷ 18 km/h offline). The natural first ML feature would be an ETA
  model — but the app doesn't yet log *actual* trip duration
  (`started_at` / `completed_at`). Now that data persists in Postgres, step zero
  is logging real durations so training data can accumulate.
- **OSRM has no live traffic**, so "fastest route" is based on typical road
  speeds. Real-time traffic would mean a paid routing API.
- **Persistence** — done: the app runs on Neon Postgres, so data persists and can
  be shared across teammates and multiple server instances.

---

## 9. History at a glance

Built incrementally on `main`:

- Scaffolded from Google AI Studio → fixed the invalid Gemini model, missing
  `dotenv`, hard-coded port, and branding.
- Added the real multi-user backend (Express + `node:sqlite`, race-safe accept,
  per-rider decline, chat, ratings, TMO reports) and the polling client.
- Fixed a blank-map-on-mode-switch bug (React was overwriting Leaflet's runtime
  classes) and the fleet-poll render loop.
- Made the live trip readable on both screens (stage-aware route + status),
  aligned pin colours, added the post-trip rating prompt.
- Hid unbooked riders from the passenger map, renamed the assistant to
  **Gently**, and turned the rider marker into a real-time compass arrow.
- Reworked the active-trip panel: actions gated until a rider accepts, live
  status + distance header, "Total Fare" relabel.
