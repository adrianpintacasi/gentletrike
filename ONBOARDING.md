# GentleTrike — Team Onboarding

Everything a new groupmate needs to run the project and collaborate without
breaking the live site. Read it top to bottom the first time.

For *what the project is and why*, see [NOTES.md](NOTES.md). This file is only
about **getting set up and working together**.

---

## 1. Install these once (prerequisites)

| Tool | Why | Get it |
| ---- | --- | ------ |
| **Node.js 24 or newer** | The database (`node:sqlite`) is built into Node 24. Older Node **will not run this project.** | https://nodejs.org (pick "24 LTS" or newer) |
| **Git** | To download the code and share changes. | https://git-scm.com |
| **VS Code** | Recommended editor. | https://code.visualstudio.com |
| A **GitHub account** | So the owner can give you access. | https://github.com |

Check Node is new enough — this must say v24 or higher:

```bash
node -v
```

If it says v22, v20, etc., install Node 24 first. Nothing else will work until this is right.

---

## 2. Get the code (each person, once)

1. Ask the owner (Adrian) to add you as a **collaborator** on GitHub.
2. Accept the email invite from GitHub.
3. Open a terminal in the folder where you keep projects and run:

```bash
git clone https://github.com/adrianpintacasi/gentletrike.git
cd gentletrike
npm install
```

`npm install` downloads all the libraries. It can take a couple of minutes the first time.

---

## 3. Set up your local secrets file

The app talks to a Google Gemini AI key. **This key is never stored in Git** —
each person supplies their own local copy.

1. Copy the example file to a real one named **`.env`**:

   ```bash
   # Windows PowerShell
   Copy-Item .env.example .env
   ```
   ```bash
   # Mac / Linux
   cp .env.example .env
   ```

2. Open `.env` and paste a Gemini key between the quotes:

   ```
   GEMINI_API_KEY="your-key-here"
   ```

   Get a **free** key at https://aistudio.google.com/apikey (use your own Google account).

> The AI key is **optional**. Without it the app still runs — the assistant just
> gives canned fare answers instead of live AI replies. So you can skip this and
> start coding immediately if you want.

**Never commit `.env`.** It's already gitignored, so Git ignores it automatically. Don't fight that.

---

## 4. Run it

```bash
npm run dev
```

Then open **http://localhost:3000** in your browser.

To simulate **two people** (a passenger and a rider) on one laptop: open the site
in a **normal window** and again in an **incognito/private window**. Each window
is treated as a separate person.

> **Windows note:** if `npm` misbehaves in PowerShell, use `npm.cmd run dev` instead.
> GPS works on `localhost`; the rider **compass only works on a real phone**, not a laptop.

---

## 5. How we work together (READ THIS — it protects the live site)

The live site auto-deploys **every time something lands on the `main` branch.**
So we **never** commit straight to `main`. We use branches + Pull Requests.

**Every time you start a piece of work:**

```bash
git checkout main
git pull                       # get everyone's latest work
git checkout -b your-name/what-youre-doing   # e.g. maria/login-form
```

**While working, save your progress:**

```bash
git add .
git commit -m "Short description of what you changed"
git push                       # first push: git push -u origin HEAD
```

**When the piece is done:**

1. Go to the repo on GitHub → it will offer to open a **Pull Request** from your branch.
2. Open the PR, write what you changed, and ask a groupmate to review.
3. Once approved, **Merge** it. That merge is what updates the live site.

**Rules of thumb**
- One branch = one task. Small and focused is easier to review.
- `git pull` on `main` **before** starting anything new, so you don't build on stale code.
- If Git says "conflict," don't panic and don't force anything — ask the group; we resolve it together.
- Never run `git push --force` on `main`.

---

## 6. Editing the same file at the same time (optional)

For live pair-programming (like Google Docs for code), install the
**VS Code Live Share** extension. One person hosts, shares the link, others join.
This is for working *sessions* — Git is still where the real, saved code lives.

---

## 7. Current work streams (suggested split)

These are the pieces we're building next. Pick one per person/pair:

| Work stream | What it involves |
| ----------- | ---------------- |
| **Persistence** | Move off the resetting free-tier database so data survives (paid disk or Postgres). *Do this first — others depend on it.* |
| **Accounts / login** | Sign-up + sign-in with hashed passwords and a `role` (passenger / rider / admin). Replaces the current no-login setup. |
| **TMO / admin dashboard** | Admin-only page (login by employee ID) to handle reports, ratings, and approve riders. |
| **AI assistant upgrade** | Let "Gently" answer from live app data (fares, trips, drivers) via function calling. |
| **Trip-data logging** | Record real `started_at` / `completed_at` times per ride so we can analyze ETAs later. |

Coordinate in the group chat before two people take overlapping streams.

---

## Quick reference

```bash
node -v                        # must be >= v24
git clone https://github.com/adrianpintacasi/gentletrike.git
cd gentletrike
npm install
cp .env.example .env           # then paste your Gemini key (optional)
npm run dev                    # open http://localhost:3000

# daily flow
git checkout main && git pull
git checkout -b your-name/task
# ...work...
git add . && git commit -m "..." && git push
# then open a Pull Request on GitHub
```
