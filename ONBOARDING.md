# GentleTrike — Developer Setup & Contributing Guide

Everything you need to run the project locally and contribute to the codebase.
Read it top to bottom to get started.

For *what the project is and why*, see [NOTES.md](NOTES.md). This file is only
about **getting set up and working together**.

---

## 1. Install these once (prerequisites)

| Tool | Why | Get it |
| ---- | --- | ------ |
| **Node.js 24 or newer** | We target modern Node APIs. Older Node versions are not officially supported. | https://nodejs.org (pick "24 LTS" or newer) |
| **Git** | To download the code and share changes. | https://git-scm.com |
| **VS Code** | Recommended editor. | https://code.visualstudio.com |
| A **GitHub account** | To fork the repository and open Pull Requests. | https://github.com |

Check Node is new enough — this must say v24 or higher:

```bash
node -v
```

If it says v22, v20, etc., install Node 24 first. Nothing else will work until this is right.

---

## 2. Get the code

1. Fork the repository on GitHub if you plan to contribute.
2. Open a terminal in your workspace and run:

```bash
git clone https://github.com/<your-username>/gentletrike.git
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

2. Open `.env` and paste an API key between the quotes:

   ```
   OPENAI_API_KEY="your-key-here"
   ```



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

## 5. How to contribute

We use a standard Pull Request (PR) workflow. Please **never** commit straight to `main`. 

**Every time you start a piece of work:**

```bash
git checkout main
git pull                       # get the latest code
git checkout -b feature/your-feature-name
```

**While working, save your progress:**

```bash
git add .
git commit -m "Short description of what you changed"
git push -u origin feature/your-feature-name
```

**When the piece is done:**

1. Go to your fork on GitHub and open a **Pull Request** against the main repository.
2. Write a clear description of what you changed and why.
3. Once reviewed and approved, it will be merged.

**Rules of thumb**
- One branch = one task. Small, focused PRs are much easier to review.
- Always run `git pull` on `main` **before** starting anything new.
- If you encounter merge conflicts, resolve them locally before updating your PR.
- Never run `git push --force` on the `main` branch.

---



## Quick reference

```bash
node -v                        # must be >= v24
git clone https://github.com/<your-username>/gentletrike.git
cd gentletrike
npm install
cp .env.example .env           # then paste your OpenAI key (optional)
npm run dev                    # open http://localhost:3000

# daily flow
git checkout main && git pull
git checkout -b feature/task
# ...work...
git add . && git commit -m "..." && git push
# then open a Pull Request on GitHub
```
