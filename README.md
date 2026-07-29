# 🛺 GentleTrike — Dumaguete Public Hailing

A public-transport hailing app for Dumaguete City, the City of Gentle People.
Passengers book a pedicab, habal-habal or multicab; riders accept trips from a
shared queue and drive them to completion with live GPS on a real street map.

Two phones, one server: what one person books, another person sees.

---

## Prerequisites

**Node.js 24 or newer** — <https://nodejs.org>.

**Node.js 24 or newer** — <https://nodejs.org>.

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

The database runs on Neon Postgres, so a valid connection string is required in `.env.local`.

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
- The filesystem is wiped on restart, but since data is stored in Neon Postgres, rides and drivers will persist. The bottom of
  `render.yaml` documents the paid disk option if local file storage is ever needed.

### Railway

Railway auto-detects the `build` and `start` scripts, so no config file is
needed. Set `NODE_VERSION=24`, then add a volume mounted at `/var/data` and set
`DATABASE_PATH=/var/data/gentletrike.db` to keep data across deploys.

---

## How it works

The system's architecture, data model, dispatch rules, fare calculation, and AI features are extensively documented in **[SYSTEMS.md](SYSTEMS.md)**.
Please refer to it for a complete overview of the project's technical design and implementation details.

For authentication and user registration details, see [AUTH.md](AUTH.md).

## Scripts

| Command         | What it does                              |
| --------------- | ----------------------------------------- |
| `npm run dev`   | Server + Vite with hot reload, port 3000  |
| `npm run build` | Build the client and bundle the server    |
| `npm start`     | Run the production build                  |
| `npm run lint`  | Typecheck with `tsc --noEmit`             |
