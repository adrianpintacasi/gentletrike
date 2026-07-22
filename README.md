# 🛺 GentleTrike — Dumaguete Public Hailing

A public-transport hailing app for Dumaguete City, the City of Gentle People.
Passengers book a pedicab, habal-habal or multicab; riders accept trips from a
shared queue and drive them to completion with live GPS on a real street map.

Two phones, one server: what one person books, another person sees.

---

## Prerequisites

**Node.js 24 or newer** — <https://nodejs.org>.

Version 24 is not optional: the database runs on `node:sqlite`, which is built
into Node itself from v24 and unavailable before it. That choice means there is
no native module to compile, so `npm install` needs no C++ build tools.

```bash
node --version   # must print v24.x or newer
```

## Run it locally

```bash
npm install
cp .env.example .env.local   # then add your Gemini key (optional)
npm run dev
```

Open <http://localhost:3000>.

The database file is created automatically at `data/gentletrike.db` on first
run. Delete that folder any time you want a clean slate.

## Try the multi-user flow

You need two browser windows — a normal one and a **private/incognito** one.
Each window gets its own device id, so they act as two different people.

| Window                | Do this                                                            |
| --------------------- | ------------------------------------------------------------------ |
| A (normal)            | Pick a pickup + drop-off, then **Book GentleTrike**                |
| B (incognito)         | Click **Switch to Rider** → **Go Online Now**                      |
| B                     | The request from window A appears in the queue → **Accept**        |
| A                     | Status flips to "Rider Assigned" and the driver appears on the map |
| B                     | Step the trip: *arriving* → *passenger onboard* → **Complete**     |
| A                     | Follows along live, and can chat with the rider                    |

Two windows on the same laptop both count as separate users. For a real demo,
use two actual phones against a deployed URL (below).

---

## Deploy so anyone can use it

### Render (recommended — free, gives you an HTTPS URL)

[render.yaml](render.yaml) is already configured for the free plan; nothing in
it needs editing before the first deploy.

```bash
git init
git add .
git commit -m "GentleTrike: Dumaguete public hailing app"
git branch -M main
git remote add origin https://github.com/<your-username>/gentletrike.git
git push -u origin main
```

Then on <https://render.com>: **New → Blueprint** → pick the repo → **Apply**.
Render reads `render.yaml` and provisions everything. First build takes 3–5
minutes; you end up with `https://gentletrike-xxxx.onrender.com`.

`GEMINI_API_KEY` is marked `sync: false`, so Render prompts for it during setup
rather than reading it from the repo. Leave it blank if you don't need the AI
guide — the assistant falls back to canned local fare answers.

Two caveats on the free plan, both harmless for a demo:

- The service sleeps after ~15 minutes idle; the next visit takes ~30s to wake.
- The filesystem is wiped on restart, so rides and drivers reset. Fine within
  one demo session; it just won't persist overnight. The bottom of
  `render.yaml` documents the paid disk that fixes it.

### Railway

Railway auto-detects the `build` and `start` scripts, so no config file is
needed. Set `NODE_VERSION=24`, then add a volume mounted at `/var/data` and set
`DATABASE_PATH=/var/data/gentletrike.db` to keep data across deploys.

---

## How it works

```
  Passenger phone                Rider phone
        │                             │
        │  POST /api/rides            │  GET  /api/rides/open
        │  GET  /api/rides/:id        │  POST /api/rides/:id/accept
        │  (polls every 2.5s)         │  POST /api/rides/:id/status
        │                             │  PATCH /api/drivers/:id  ← live GPS
        └──────────► Express + SQLite ◄──────────┘
```

Clients poll rather than hold a WebSocket. It is a few lines instead of a
reconnection state machine, it survives phone sleep and flaky campus Wi-Fi, and
at demo scale the load is trivial. Polling pauses while a tab is hidden.

There are no user accounts. Each browser generates a device id into
`localStorage`, which is how a phone reclaims its own trip after a reload and
how a rider keeps hold of the same pedicab unit.

### Project layout

| Path                        | What lives there                                  |
| --------------------------- | ------------------------------------------------- |
| [server.ts](server.ts)      | Express entry, Vite middleware, Gemini endpoint    |
| [server/db.ts](server/db.ts)         | `node:sqlite` setup, schema, seed, row → JSON |
| [server/routes.ts](server/routes.ts) | The `/api` surface                        |
| [src/api.ts](src/api.ts)             | Typed client for that API + device id     |
| [src/hooks/usePolling.ts](src/hooks/usePolling.ts) | Visibility-aware polling    |
| [src/App.tsx](src/App.tsx)           | State, passenger and rider flows           |
| [src/components/](src/components/)   | Map, booking panel, rider panel, modals   |
| [src/data/dumagueteData.ts](src/data/dumagueteData.ts) | Landmarks, fleet, fare table |

### API

| Method | Route                        | Purpose                                 |
| ------ | ---------------------------- | --------------------------------------- |
| GET    | `/api/health`                | Health check (used by Render)           |
| GET    | `/api/drivers`               | Fleet; `?online=1` for on-duty only     |
| POST   | `/api/drivers/claim`         | Take a pedicab unit for this device     |
| PATCH  | `/api/drivers/:id`           | Push GPS position / duty status         |
| GET    | `/api/drivers/:id/rides`     | That rider's pooled trips               |
| POST   | `/api/rides`                 | Book a trip                             |
| GET    | `/api/rides/open`            | Unclaimed requests for a rider          |
| GET    | `/api/rides/:id`             | Poll one trip                           |
| POST   | `/api/rides/:id/accept`      | Claim a trip (first request wins)       |
| POST   | `/api/rides/:id/decline`     | Hide it from this rider only            |
| POST   | `/api/rides/:id/status`      | Advance the trip stage                  |
| POST   | `/api/rides/:id/cancel`      | Cancel                                  |
| GET  / POST | `/api/rides/:id/messages` | In-trip chat                         |
| POST   | `/api/tmo-reports`           | File a TMO complaint, returns a ref code |

Two riders tapping **Accept** at the same instant is settled in the database:
the update only matches while `driver_id IS NULL`, so the second one gets a 409
and a clear message rather than silently stealing the trip.

## Fare rules

₱15 base for the first kilometre, +₱2 per additional kilometre, per passenger.
Pakyaw (charter) trips replace that with a negotiated flat fare. The rates live
in `VEHICLE_DETAILS` in [src/data/dumagueteData.ts](src/data/dumagueteData.ts).

**Distance is the real driving distance**, fetched from OSRM in
[src/utils/dumagueteRouting.ts](src/utils/dumagueteRouting.ts) — not the
straight line between the two pins. That distinction matters: measured across
six common Dumaguete routes, the road runs on average **1.32×** longer than the
crow flies, so charging on straight-line distance undercharged every trip.

| Route | Straight | Road | Pedicab fare |
| ----- | -------- | ---- | ------------ |
| Silliman → Robinsons | 2.2 km | 2.9 km | ₱17 → ₱19 |
| Boulevard → Sibulan Airport | 3.0 km | 4.3 km | ₱19 → ₱22 |
| Pier 1 → Robinsons | 2.4 km | 3.3 km | ₱18 → ₱20 |

The booking panel quotes nothing until the route resolves, so the fare shown is
always the fare charged. If the OSRM public server is unreachable the app falls
back to the straight line scaled by that 1.32 factor and labels the figure
`(approx)` rather than silently quoting a wrong number.

## Scripts

| Command         | What it does                              |
| --------------- | ----------------------------------------- |
| `npm run dev`   | Server + Vite with hot reload, port 3000  |
| `npm run build` | Build the client and bundle the server    |
| `npm start`     | Run the production build                  |
| `npm run lint`  | Typecheck with `tsc --noEmit`             |
