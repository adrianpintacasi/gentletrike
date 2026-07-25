# GentleTrike — Task Delegation & Roadmap

What we're building next, who can take what, and the order it has to happen in.
Plain language on purpose — you don't need to be a code expert to follow this.

> **New to the project?** Read [ONBOARDING.md](ONBOARDING.md) first to get set up.
> For *how the app works today*, see [NOTES.md](NOTES.md).

---

## The big picture

We have five improvements to make. They depend on each other, so **order matters**.
The golden rule:

> **Task 1 (make the data survive) must be done first. Everything else sits on top of it.**

```
        ┌─────────────────────────────┐
        │  1. Make the data survive    │  ← do this FIRST
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │  2. Sign up / Sign in        │  ← unlocks 3
        └──────────────┬──────────────┘
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
┌────────────┐  ┌────────────┐   ┌──────────────┐
│ 3. Admin   │  │ 5. Trip    │   │ 4. AI upgrade │
│  dashboard │  │  logging   │   │  (last)       │
└────────────┘  └────────────┘   └──────────────┘
```

---

## The tasks

Each card says what it is, why it matters, roughly how hard it is, and what
"finished" looks like.

### Task 1 — Make the data survive (persistence) 🔴 DO FIRST
- **What:** Right now the database wipes itself every time the site restarts. We fix that so accounts, rides, and reports are kept.
- **Why first:** Every other task stores data. If the data disappears, nothing else is worth building.
- **Two options:** the cheap-effort way (a paid storage disk, almost no code change) or the free-tier way (switch to a Postgres database, more code work). We'll pick one together.
- **Difficulty:** Medium. Best for the most technical person, or do it together.
- **Done when:** You can add data, restart the site, and the data is still there.

### Task 2 — Sign up / Sign in (accounts) 🟠
- **What:** Real registration and login with passwords. Each user gets a role: **passenger**, **rider**, or **admin**. Removes the current no-login setup and the fake pre-made riders.
- **Why:** Security, and it's the foundation for the admin dashboard (Task 3).
- **Difficulty:** Medium.
- **Done when:** A new person can sign up, log in, log out, and the app remembers who they are.

### Task 3 — TMO / Management dashboard 🟠
- **What:** A separate admin-only page. Login by **employee ID**. Used to view and handle **TMO reports**, see ratings, and **approve new riders**.
- **Why:** The management side of the app; also where our data insights show up.
- **Depends on:** Task 2 (needs the "admin" role and login).
- **Difficulty:** Medium. Good for someone who likes building screens/UI.
- **Done when:** An admin logs in and can see reports and act on them; non-admins can't reach it.

### Task 4 — AI assistant upgrade (do LAST) 🟢
- **What:** Make "Gently" smarter — answer using our **real app data** (actual fares, trips, riders), and switch from the Gemini key to the **OpenAI key**. This is also where we add **RAG** (the AI looks things up in our data before answering).
- **Why last:** It's easiest to plug in once the rest of the app is finished.
- **Difficulty:** Medium. Good for whoever is curious about AI.
- **Done when:** Gently gives accurate, data-based answers using the OpenAI key.

### Task 5 — Trip data logging (our data engineering piece) 🟢
- **What:** Quietly record when each trip **starts** and **ends**, plus its fare — so we collect real data. Then a small routine adds it up into daily stats (trips per day, average fare, busiest routes) shown on the dashboard.
- **Why:** This is our **data engineering** requirement — collect data, store it, shape it into useful numbers. (We agreed: **no neural network** — just collect and summarize the data.)
- **Depends on:** Task 1 (data must survive to be useful).
- **Difficulty:** Easy–Medium. Great starter task.
- **Done when:** Completed trips are recorded, and the dashboard shows real daily numbers.

---

## Suggested team split

Adjust to your group size. If you're **3 people**, pair up on the big ones.

| Person / Pair | Owns | Notes |
| ------------- | ---- | ----- |
| **A** (most technical) | Task 1 → then help Task 2 | Unblocks everyone — start immediately. |
| **B** | Task 2 → then Task 3 | Login first, then build the dashboard on it. |
| **C** | Task 5 (logging) → then Task 4 (AI) | Start logging early; AI comes at the end. |

If you're **4–5 people**, give Task 3 (dashboard) and Task 4 (AI) their own owners.

---

## How we actually work (short version)

Full details in [ONBOARDING.md](ONBOARDING.md). The loop for every task:

```bash
git pull                       # 1. get everyone's latest
git checkout -b your-name/task # 2. make your own sandbox branch
npm run dev                    # 3. test on YOUR laptop (localhost, private)
git add . && git commit -m "…" # 4. save when it works
git push                       # 5. share it
```

Test locally first — nothing you do reaches the live site until you `git push`.

---

## Order of attack (if you forget everything else)

1. **Task 1** — data survives. *Nothing else starts until this works.*
2. **Task 2** — login + roles.
3. **Task 3 + Task 5** — dashboard and trip logging (can go at the same time).
4. **Task 4** — AI upgrade with OpenAI + RAG, last.
