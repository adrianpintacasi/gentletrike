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

## 2. Architecture & Design

The project's architecture, data model, technology stack, and core design decisions (fare rules, dispatch rules, etc.) are documented in **[SYSTEMS.md](SYSTEMS.md)**. 
Please refer to it for a complete technical overview.

---


## 3. Deploying and iterating

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

## 4. Known gaps / future ideas

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
  be shared across multiple server instances.

---

## 5. History at a glance

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
