# GentleTrike — Systems Documentation & Defense Notes

> **Vision:** To make every ride in Dumaguete fair, findable, and full.

A multi-modal ride-hailing system for Dumaguete City, Negros Oriental.
Every constant in this document was read from the running system, not estimated.

| | |
|---|---|
| Source files | 71 TypeScript / TSX |
| Knowledge chunks | 2,404 (100% embedded) |
| Transport modes | 4 |
| Boundary polygon | 165 points |
| API spend to date | ≈ $0.04 of a $50 grant |

**Contents**

1. [The problem & the shape of the answer](#1-the-problem--the-shape-of-the-answer)
2. [Architecture & stack](#2-architecture--stack)
3. [Data model](#3-data-model)
4. [The fare engine](#4-the-fare-engine)
5. [Dispatch & pooling](#5-dispatch--pooling)
6. [Service area](#6-service-area)
7. [Geocoding & place resolution](#7-geocoding--place-resolution)
8. [Gently: the RAG agent](#8-gently-the-rag-agent)
9. [Tool calling & guardrails](#9-tool-calling--guardrails)
10. [Security](#10-security)
11. [Testing strategy](#11-testing-strategy)
12. [Known limits](#12-known-limits)
13. [Defense question bank](#13-defense-question-bank)
14. [The night-before sheet](#14-the-night-before-sheet)

---

## 1. The problem & the shape of the answer

Dumaguete runs on small public transport. Pedicabs have no fixed routes and no
meters — a driver takes whoever flags them down first, that passenger's
destination becomes the route, and others going roughly the same way are picked
up along it. Habal-habal, multicabs and chartered vehicles fill the gaps. Fares
are set by a city ordinance that many passengers do not know by heart, which
leaves room for overcharging, particularly with visitors.

GentleTrike addresses three distinct failures, and the system is organised
around them. The vision statement is not decoration — each word names one:

| Word | Failure it names | Where it lives |
|---|---|---|
| **fair** | Fares are negotiable in practice, so passengers overpay | `shared/fare.ts` — one ordinance-exact calculation |
| **findable** | No way to summon a ride that isn't already in front of you | `server/geocode.ts`, the dispatch queue |
| **full** | Drivers travel with empty seats; passengers wait | `shared/dispatch.ts` — detour-ranked pooling |

> **The central design principle**
>
> **The system computes; the model proposes; the human commits.**
> No fare is ever produced by the language model, and no booking is ever created
> without an explicit tap. Every guardrail below is an application of that one rule.

---

## 2. Architecture & stack

A single TypeScript codebase. The important structural decision is `shared/` —
modules imported by *both* the browser and the server, so a fare can never be
computed two different ways.

```
Browser (React + Vite)  ─┐
                         ├─→  shared/  ──  fare.ts · dispatch.ts
Express server  ─────────┘                 serviceArea.ts · transport.ts
      │
      ├──→  Neon Postgres + pgvector
      └──→  OSRM · Photon · Nominatim · OpenAI
```

| Layer | Technology | Why this one |
|---|---|---|
| UI | React 19, TypeScript, Vite, Tailwind v4 | Type safety across the shared modules is the point |
| Maps | Leaflet + OpenStreetMap | No API key; same data source as the geocoder and router |
| Server | Express 4 on Node 24 | Small surface; the logic lives in `shared/` |
| Database | Neon Postgres (serverless driver) | Persistence plus team access; migrated off `node:sqlite` because a local file can't be shared |
| Vectors | pgvector 0.8.1, HNSW index | Avoids a second database — the knowledge base sits beside the rides |
| Routing | OSRM public API | Real road distance and duration, free |
| Geocoding | Photon (search) + Nominatim (reverse) | Both OSM-derived, so they agree with the tiles |
| LLM | OpenAI `gpt-4o-mini` | Tool calling at ~0.1¢ per turn |
| Embeddings | `text-embedding-3-small`, 1536 dims | Whole corpus embedded for under two cents |
| Hosting | Render, deploys from `main` | — |

**Likely question — why not Python for the AI part?**
Because the fare rules, vehicle definitions and service-area polygon already
exist as TypeScript in `shared/`. A Python service would need its own copy of all
three, and the day those copies drift is the day the assistant quotes a fare the
app will not charge. RAG is an architecture, not a language.

---

## 3. Data model

Ten tables. The ones that matter under questioning:

| Table | Holds | Notes |
|---|---|---|
| `users` | Accounts, role, verification status | Status drives access — declined and banned accounts cannot sign in |
| `sessions` | Login tokens | Server owns identity; the client never supplies its own id |
| `drivers` | Profile, vehicle type, plate, online state | Vehicle type constrains which trips they see |
| `rides` | Pickup, drop-off, fare, status, passengers | Locations stored as JSON |
| `ride_declines` | Which driver passed on which trip | Stops a declined trip reappearing |
| `messages` | Two-way trip chat | Indexed on `ride_id`; drives unread badges |
| `kb_chunks` | Gently's knowledge base | Tier, source, year, content, `embedding vector(1536)` |
| `audit_logs` | Admin actions | Indexed on actor and time |
| `tmo_reports` | Overcharging / conduct complaints | Feeds the management dashboard |

**Worth defending:** ride locations are stored as JSON rather than a foreign key
to a places table. A passenger can now book any geocoded point in the city, and
those points have no stable identity to reference. The trade-off is that you
cannot `GROUP BY` location without parsing JSON — acceptable, because the app
never needs to.

---

## 4. The fare engine

One file, `shared/fare.ts`, is the only place money is calculated. The booking
panel, the driver panel and Gently's `estimate_fare` tool all call it.

### The ordinance rule

A flat base fare covers the first kilometre or less. Every *succeeding kilometre
**or fraction thereof*** is charged in full — a fraction always rounds **up**.
That last clause is the one people get wrong.

```ts
succeedingKm = Math.ceil(distanceKm - BASE_DISTANCE_KM - EPSILON)
fare         = baseFare + succeedingKm * perKm
```

**Why `EPSILON = 1e-9` exists.** A trip of exactly 2.000 km should bill one
succeeding kilometre. In floating-point arithmetic `2.0 - 1.0` can land a hair
above 1, and `Math.ceil` would return 2 — overcharging by a whole kilometre at
an exact boundary. Subtracting a nanometre first makes the boundary land on the
passenger's side. Expect to be asked about this.

### Published rates

| Mode | Display name | Base | Per km | Seats | Billing |
|---|---|---:|---:|---:|---|
| `pedicab_standard` | Pedicab Standard | ₱15 | ₱2 | 6 | Per passenger |
| `habal_habal` | Habal-Habal Express | ₱25 | ₱3 | 1 | Per passenger |
| `multicab` | EasyRide | ₱15 | ₱2 | 12 | Per passenger |
| `pakyaw_charter` | Pakyaw Charter | ₱70 | ₱5 | 12 | **Flat for the vehicle** |

Pakyaw is the exception that proves the rule: it is a *charter*, so the fare is
not multiplied by head count, and the computed figure is a **minimum** rather
than a price — the passenger offers at or above it and the driver accepts or passes.

### Discounts

The TMO grants students, seniors and PWDs 20% off with valid ID.
**GentleTrike does not apply it.** The app quotes and books the full fare and
tells the passenger to arrange the discount with the driver.

This is a deliberate scope decision, not an oversight: automatic discounting
requires ID verification the system does not perform, and a discount granted on
an unverified claim is a fare dispute waiting to happen. Gently states the
entitlement plainly and never subtracts it from a figure.

---

## 5. Dispatch & pooling

The most defensible engineering in the project, because it models real local
behaviour rather than copying Grab or Uber. Those apps assign one driver to one
booking. Dumaguete pools: the first passenger sets the direction, and the driver
adds others who are roughly on the way.

### Turning "on the way" into a number

The question is never *"how far is this passenger?"* but
**"how much further do I drive if I take them too?"** That is the **detour**,
and it is what the system ranks by.

```
detour = shortest route including the new pickup + drop-off
       − route the driver is already committed to
```

The insertion search tries every position `i` for the new pickup and every
position `j >= i` for the drop-off — nobody is set down before being collected.
It is quadratic, but the stop list is a handful of trips, so it finds the genuine
best insertion rather than approximating one.

### Parameters

| Constant | Value | Meaning |
|---|---:|---|
| `ROAD_FACTOR` | 1.32 | Straight-line → road distance, offline |
| `ALONG_THE_WAY_KM` | 0.8 | Detour below which a trip earns an "on the way" badge |
| `HIDE_BEYOND_KM` | 3 | Detour above which a trip is wrong-direction and hidden |
| `FIRST_PASSENGER_RADIUS_KM` | 3 | Search radius for an idle driver, who has no route yet |
| `EXACT_SEQUENCE_LIMIT` | 8 | Stops up to which every legal ordering is measured exhaustively |

> **The decision to defend hardest**
>
> **0.8 km is a label, not a filter.** An earlier version hid every trip above
> that line — and the queue emptied the instant a driver accepted anyone, the
> exact opposite of pooling. The rule became *rank, don't hide*: sort by detour,
> show the cost honestly, let the driver judge. Only genuinely wrong-direction
> trips beyond 3 km are removed.

**Why 0.8 km when the brief said 200–400 m?** A driver picturing "200 m off my
route" is imagining the perpendicular offset. The system measures round-trip
cost: reaching a pickup behind you and coming back counts in full, so a 300 m
offset routinely costs 600 m of driving. The constant is set against the
measurement, not the intuition.

### Stop sequencing

Accepting trips in order and driving them in that order produces a zigzag — out
to a drop-off, back for a pickup. With eight or fewer stops the system measures
**every legal ordering** (respecting pickup-before-drop-off) and takes the
shortest; above that it falls back to greedy nearest-next. A pedicab rarely
carries more than three trips, so exact is the normal case and greedy is the
safety valve.

### Charter exclusivity

A pakyaw charter hires the whole vehicle, so pooling anything into it would sell
the same seats twice. Two rules, enforced server-side on both the queue and the
accept endpoint: a driver already carrying a charter sees an empty queue, and a
driver carrying anyone cannot accept a charter.

**A real bug worth telling the story of.** Pakyaw bookings reached *no drivers at
all*. The queue filter compared `ride.vehicle_type === driver.vehicle_type`, but
pakyaw is an *arrangement*, not a vehicle class — drivers register as pedicab,
habal-habal or multicab, and any of them can be chartered, so nothing ever
matched. `canServeTrip()` now encodes that distinction. A category error in a
data model producing silent failure rather than an exception.

---

## 6. Service area

Free-text search can return anywhere on earth. The fare table and the driver
network are Dumaguete-only, so a result outside the city is not a trip the system
can price.

The boundary is the **real OpenStreetMap administrative polygon** for Dumaguete
City (relation 15051886, 165 points), not a bounding box. A rectangle around the
city swallows parts of Sibulan, Valencia and Bacong — separate municipalities
with their own transport and their own fare matrices.

Membership is tested by **ray casting**: count how many times a ray heading east
from the point crosses the polygon edge; an odd number means inside. A cheap
bounding-box rejection runs first.

**The Sibulan Airport exception.** The city's airport is in Sibulan, and the
polygon correctly excludes it — but it is a real, bookable pickup point. Rather
than loosening the boundary (which would also admit unrelated parts of Sibulan),
the system trusts its own curated points explicitly, within ~400 m. A named
exception beats a distorted boundary.

**Why the boundary stays.** Not unwillingness to drive to Bacong — **each
municipality sets its own fare matrix**, so the ordinance the app implements has
no authority there. This is why out-of-city requests are offered a pakyaw charter
instead: a negotiated flat price needs no tariff.

---

## 7. Geocoding & place resolution

### Why the lookup is proxied through the server

- Both providers require an identifying `User-Agent`, which browsers refuse to set.
- Fair-use rate limits can only be honoured somewhere central.
- A shared cache means twenty passengers searching "robinsons" cost one request.

| Parameter | Value | Reason |
|---|---:|---|
| `CACHE_TTL_MS` | 30 min | Places do not move |
| `MAX_CACHE` | 500 | Bounded memory; oldest evicted first |
| `MIN_GAP_MS` | 1100 | Nominatim asks for ≤1 request/second |
| search limit | 12 → 8 | Fetch 12, dedupe, return 8 |

Results are clamped to the boundary's bounding box, filtered through the exact
polygon test, and de-duplicated — Photon returns the same shop several times from
different OSM objects.

### Two-stage place resolution

The 16 curated points are tried first (offline, instant, free); the geocoder runs
only on a miss. This keeps token and network cost flat for the common case while
still reaching the whole city.

```
passenger's words
      │
      ├─ curated match?  confidence >= 0.34  AND  coverage >= 0.6
      │       ├─ unique      → resolved
      │       └─ two points tie → ASK which
      │
      └─ no match → geocoder
              ├─ clear winner          → resolved
              ├─ rivals within margin  → ASK which
              └─ nothing               → ASK to rephrase
```

| Threshold | Value | Guards against |
|---|---:|---|
| `MIN_CONFIDENCE` | 0.34 | Noise matches quoting a fare for the wrong place |
| `MIN_COVERAGE` | 0.6 | "Foundation University" snapping to *Silliman* University |
| `CURATED_TIE_MARGIN` | 0.15 | "Terminal" silently choosing between Ceres and Valencia |
| `AMBIGUITY_MARGIN` | 0.75 | Taking the geocoder's first hit when the second is just as good |
| `SAME_PLACE_KM` | 0.15 | Asking about two hits that are the same mall entrance |

**Confidence vs coverage — know this distinction.**
*Confidence* asks how strongly a place matched. *Coverage* asks how much of what
the passenger said it explains. "Foundation University" scores 0.375 against
Silliman University Portal on the shared word *university* alone — enough
confidence, but only 0.5 coverage. Two different questions; one number cannot
answer both.

**The Valencia bug — the best story in the project.**
The app has a "Valencia Jeepney & Bus Terminal", which is on Colon Street in
*downtown Dumaguete* — where you catch a jeepney *to* Valencia, a town 9 km
inland. Fuzzy matching scored the town name against the terminal and quoted ₱17
for a 1.14 km hop, then offered to book it. A passenger could have confirmed that
believing they were going up the mountain. The fix runs an out-of-coverage check
*before* fuzzy matching, and demoted the descriptive blurb field so it can never
carry a match on its own.

---

## 8. Gently: the RAG agent

Retrieval-Augmented Generation: instead of trusting the model's memory, the
system retrieves relevant passages from its own corpus and puts them in the
prompt. The model writes prose; the facts come from the database.

```
question
   │
   ├─ fare or legal wording?  ── yes ──→  tiers = official ONLY
   │                          ── no  ──→  tiers = official + local + reference
   │
   ├─ embed query (text-embedding-3-small, 1536 dims)
   ├─ pgvector HNSW: cosine distance + age penalty
   │       └─ no hits → Postgres full-text fallback → substring probe
   ├─ label top 4 chunks by trust tier, format into prompt
   └─ gpt-4o-mini writes the answer
```

### The corpus, as it stands today

| Tier | Chunks | Source | Trust rule |
|---|---:|---|---|
| `official` | 26 | Repo-owned: ordinance, fare table, locations | Authoritative. Always wins. |
| `local` | 2,107 | dumaguete.com (WordPress REST API) | Quotable with a "confirm before travelling" caveat |
| `reference` | 271 | Wikivoyage 127, Wikipedia 144 | Never state prices, schedules or company names as current |

**2,404 chunks total, all 2,404 embedded.**

### Ingestion parameters

| Parameter | Value | Reason |
|---|---:|---|
| `TARGET_CHARS` | 900 | ≈220 tokens — one coherent idea per chunk |
| `MAX_CHARS` | 1400 | Hard ceiling before a forced split |
| `MIN_CHARS` | 200 | Below this it is a heading stub with nothing retrievable |
| embedding dims | 1536 | `text-embedding-3-small` |
| embed batch | 96 | Chunks per API call |
| `topK` | 4 | Chunks placed in the prompt per question |

Splits prefer paragraph boundaries, so a sentence and its price do not land in
different chunks. Each chunk carries a `content_hash` and an `embedded_hash`;
re-ingesting only re-embeds what actually changed, which is why the corpus has
been rebuilt repeatedly for almost no cost.

### The ₱9 problem — why tiers are enforced in SQL

> **The single most defensible decision in the AI work.**
>
> The ingested Wikivoyage page states the pedicab fare is "regulated at ₱9 per
> person". The real TMO baseline is ₱15. **61 of 271 reference chunks carry peso
> figures**, most from 2017–2020. A prompt instruction saying "prefer official
> sources" would not reliably survive a retrieved chunk stating a number that
> confidently — so the filter runs *in the SQL `WHERE` clause*. On a fare or legal
> question, lower tiers are never retrieved at all. The model cannot ignore an
> instruction it was never given the chance to see.

Classification is a regex over the question, and it includes Cebuano and Tagalog
price words — `tagpila`, `pila`, `magkano` — because passengers in Dumaguete ask
that way. `pila` also means "queue", but a false positive only narrows retrieval
to authoritative rows, which is the safe direction to fail.

### Recency: the age penalty

Pure similarity ranked a 2021 ferry page beside a 2024 one, because both are
equally *about* ferries — but one named a shipping line that had stopped
operating. Ranking therefore adds **0.012 cosine distance per year of age**,
capped at 10 years, with undated chunks assumed 8 years old.

The size is deliberate: cosine distance spans roughly 0.2–0.4 between a good and
a mediocre match, so a decade of age costs 0.12 — enough to reorder near-equal
chunks, never enough to promote an irrelevant one.

### Hybrid retrieval

Vector search is primary; if embedding fails or returns nothing, the system falls
back to Postgres full-text search (`ts_rank` over `plainto_tsquery`), and below
that to a substring probe on the longest word. `plainto_tsquery` ANDs every term,
so a long natural question often matches nothing — the probe stops that becoming
a dead end. The keyword path also means the whole pipeline was testable before an
API key existed.

---

## 9. Tool calling & guardrails

Gently has four tools. Notice what is absent: there is no tool that books a ride.

| Tool | Does | Guardrail |
|---|---|---|
| `search_knowledge` | Retrieves corpus passages | Tier filter applied in SQL |
| `estimate_fare` | Computes an exact fare | Calls `shared/fare.ts`; the model never does arithmetic |
| `plan_route` | Road distance and duration | OSRM, with an "estimate" flag when unreachable |
| `draft_booking` | Prepares a summary card | **Books nothing.** Requires a human tap on Confirm |

| Budget guard | Value | Stops |
|---|---:|---|
| `MAX_TOOL_ROUNDS` | 4 | A model retrying a failing tool forever |
| `MAX_CALLS_PER_ROUND` | 3 | One response fanning out into dozens of calls |

### Guardrails, in order of importance

1. **The model never computes money.** An earlier prompt asked it to do ceiling
   arithmetic and warned "never multiply fractions by ₱2" — a losing strategy.
   Its job was reduced to choosing arguments.
2. **Confirm-before-booking.** `draft_booking` returns exactly the shape
   `POST /api/rides` expects, minus `passengerId` — the server takes identity
   from the session, so a model cannot book on someone else's behalf even if it tried.
3. **Out-of-coverage detection runs before fuzzy matching**, so a town name can
   never resolve to a same-named terminal.
4. **Ambiguity is surfaced, never resolved silently**, on both the curated and
   geocoded paths.
5. **Onward travel is data, not inference.** Each out-of-coverage place carries
   its own route. Given a menu of terminals to choose from, the model once
   invented a ferry to Sibulan — a town 5 km up the coast by road.

### Cost control

A `MockProvider` implements the same interface as the OpenAI provider, so the
entire tool layer, retrieval pipeline and agent loop can be tested at **zero
token cost**. Total project spend is around **four cents of a $50 grant**. A
typical real turn costs roughly a tenth of a cent.

---

## 10. Security

| Concern | Handling |
|---|---|
| Password storage | `scrypt`, 16-byte random salt, 64-byte derived key |
| Password comparison | `timingSafeEqual` — constant time, resists timing attacks |
| Identity | Server reads the user from the session; the client never supplies its own id |
| Booking | Verified by attempting an unauthenticated POST with an injected `passengerId` — rejected 401 |
| Account state | Declined and banned accounts cannot sign in; banned accounts cannot appeal |
| Secrets | `.env` gitignored; the API key lives only in Render's environment |

> **Declare this before they find it.**
>
> **Several driver and ride endpoints are not authenticated.**
> `POST /rides/:id/accept`, `/cancel`, `/status` and `PATCH /drivers/:id` attach a
> user if one is present but do not require one, and `accept` takes `driverId`
> from the request body. A crafted request could accept a ride as another driver.
> It is a known, documented gap — and volunteering it is far stronger than being
> caught by it.

---

## 11. Testing strategy

Every suite runs offline against the mock provider, so the whole thing can be
verified on every change for nothing.

| Command | Covers |
|---|---|
| `npm run lint` | `tsc --noEmit` across all 71 files |
| `npm run gently:test` | Tier filtering, fare arithmetic, coverage, ambiguity, out-of-coverage routing, the full agent loop |
| `npm run dispatch:test` | Detour maths, sequencing precedence, charter exclusivity, capacity |
| `npm run area:test` | Polygon membership, the airport exception, malformed input |
| `npm run chat:test` | Two-way messaging and unread counts |
| `npm run test:cancel` | The cancel race — an in-flight poll resurrecting a cancelled ride |
| `npm run kb:status` | Corpus size, embedding coverage, tier breakdown |

The pure-function design of `shared/dispatch.ts` — no database, no network — is
what makes exhaustive testing of the pooling logic possible at all.

---

## 12. Known limits

Naming these yourself converts a weakness into evidence of judgement.

| Limit | Why it stands |
|---|---|
| Unauthenticated ride endpoints | Known gap; the highest-priority fix |
| No automatic 20% discount | Requires ID verification the system does not perform |
| Dumaguete City only | Each municipality has its own fare matrix |
| Gently cannot use live GPS | Deliberately deferred; it asks for a pickup instead |
| OSM coverage gaps | Schools, malls and streets resolve well; a new carinderia may not be mapped. Falls back to asking, and the map pin always works |
| Greedy sequencing above 8 stops | Exhaustive search stops being instant; a pedicab rarely exceeds three trips |
| No GCash integration | Out of scope for this iteration |
| Straight-line detour scoring | Road-aware ordering was measured: 1.2% better for a 2.2 s API call. Not worth it |

---

## 13. Defense question bank

Try to answer aloud before reading the answer.

### On RAG and the AI

**Q — What is RAG, in one sentence?**
Retrieval-Augmented Generation: rather than relying on what the model memorised
during training, the system retrieves relevant passages from its own corpus at
question time and puts them in the prompt, so answers are grounded in data we
control and can update.

**Q — Why not fine-tune, or just put everything in the prompt?**
Fine-tuning bakes facts into weights, so correcting a fare means retraining — and
it gives you no citation. Putting everything in the prompt is impossible at 2,404
chunks and would cost a fortune per message. Retrieval selects the four most
relevant chunks per question: cheap, current, and updatable by re-running ingestion.

**Q — Walk me through what happens when I ask Gently a question.**
The question is classified as fare/legal or general, which decides which tiers
may be searched. It is embedded with `text-embedding-3-small` into a
1536-dimension vector. pgvector finds the nearest chunks by cosine distance under
an HNSW index, plus an age penalty. The top 4 are labelled by trust tier and
formatted into the prompt. `gpt-4o-mini` then writes prose, calling tools for
anything factual — fares, routes, drafts.

**Q — Why is the tier filter in SQL rather than in the prompt?**
Because prompt instructions are advisory and retrieved text is persuasive.
Wikivoyage states the fare is ₱9; the real baseline is ₱15, and 61 of 271
reference chunks carry peso figures. Telling the model to "prefer official
sources" while handing it a confident wrong number is a gamble. Filtering in the
`WHERE` clause means those chunks are never retrieved on a fare question — the
model cannot be misled by text it never receives.

**Q — What is cosine similarity and why use it?**
It measures the angle between two vectors rather than their magnitude, so it
compares direction of meaning independent of text length. A short chunk and a
long one about the same topic still score as similar. pgvector's `<=>` operator
returns cosine distance, and the HNSW index makes that search approximate but
near-instant.

**Q — Why 900-character chunks?**
Roughly 220 tokens — large enough to hold one coherent idea with its context,
small enough that four fit comfortably in a prompt. Splits prefer paragraph
boundaries so a sentence and its price do not land in different chunks. Anything
under 200 characters is a heading stub with nothing retrievable in it.

**Q — How do you stop it giving out-of-date information?**
Three layers. Tier filtering keeps stale sources out of fare answers entirely. An
age penalty of 0.012 cosine distance per year, capped at ten, demotes older
chunks when two are otherwise equal. And formatting labels every chunk by trust:
official is authoritative, local is quotable with a caveat, reference must never
be stated as current fact.

**Q — Can Gently book a ride by itself?**
No, and that is architectural rather than a prompt instruction. There is no tool
that creates a booking. `draft_booking` returns a summary card and the passenger
must tap Confirm. The draft deliberately omits `passengerId` — the server takes
identity from the session — so even a compromised model cannot book on another
person's behalf.

**Q — What stops it inventing a fare?**
It never calculates one. `estimate_fare` calls the same `shared/fare.ts` the
booking panel uses and returns the figure marked authoritative. An earlier design
asked the model to do ceiling arithmetic itself and it was unreliable, so the
responsibility moved into code.

**Q — How did you keep API costs down?**
A mock provider implementing the same interface, so all development and testing
ran at zero token cost; a keyword-search fallback so the pipeline worked before a
key existed; incremental embedding via content hashes; and hard caps of 4 tool
rounds and 3 calls per round. Total spend is about four cents of the $50 grant.

**Q — Why `gpt-4o-mini` and not a larger model?**
The model's job is narrow: choose tool arguments and write two short paragraphs.
The facts come from retrieval and the arithmetic from code, so reasoning depth is
not the bottleneck. A mini model does that reliably at roughly a tenth of a cent
per turn, which matters on a fixed grant.

### On dispatch and pooling

**Q — How does the system decide which driver gets a booking?**
It does not assign — it ranks and offers. An idle driver sees nearby trips sorted
by pickup distance within 3 km. A driver already carrying passengers sees trips
sorted by *detour*: how much further they drive by taking this one too. Drivers
accept; the system never assigns.

**Q — How do you know a trip is "along the way" and not the opposite direction?**
Because detour is computed against the committed route, not as a distance to the
passenger. The best insertion of the new pickup and drop-off into the existing
stop list is found, and the baseline route length subtracted. A passenger behind
the driver produces a large detour automatically — direction is captured by the
measurement, not tested separately.

**Q — Why is 0.8 km a badge rather than a cut-off?**
Because when it was a cut-off, accepting one passenger emptied the queue — the
opposite of pooling. Drivers know their roads better than a constant does, so the
system ranks by detour and states the cost honestly, hiding only genuinely
wrong-direction trips beyond 3 km.

**Q — You said 200–400 m was realistic. Why is the constant 0.8 km?**
Those measure different things. A driver imagines the perpendicular offset from
their route; the system measures round-trip cost, and reaching a pickup slightly
behind you and returning counts in full. A 300 m offset routinely costs 600 m of
driving.

**Q — Why exhaustive search up to 8 stops instead of always greedy?**
Greedy nearest-next can strand a stop and force a double-back. With eight or
fewer stops every legal ordering can simply be measured, so the true shortest
route is found rather than approximated. A pedicab rarely carries more than three
trips, so exact is the normal case; greedy is the safety valve above the limit.

**Q — What stops a driver being given more passengers than seats?**
A numeric `maxPassengers` per vehicle type — 6 pedicab, 1 habal-habal, 12
multicab — enforced on the server at accept time, returning 409 with a clear
message. The display string "4-6 passengers" cannot be checked programmatically,
which is why the numeric field exists alongside it.

**Q — Why did pakyaw bookings reach nobody?**
A category error. The queue compared the ride's vehicle type to the driver's, but
pakyaw is an *arrangement*, not a vehicle class — drivers register as pedicab,
habal-habal or multicab, so no driver ever equalled `pakyaw_charter` and the
requests silently matched nobody. `canServeTrip()` now encodes that any vehicle
can be chartered, while charters remain exclusive.

### On geocoding and the service area

**Q — Why a polygon instead of a radius or bounding box?**
A rectangle around Dumaguete includes parts of Sibulan, Valencia and Bacong —
separate municipalities with their own fare matrices. The real OSM administrative
boundary (165 points) is tested by ray casting, with a bounding-box check first
as a cheap rejection.

**Q — Explain ray casting.**
Draw a ray from the point in one direction and count how many polygon edges it
crosses. An odd number means inside; even means outside. O(n) in the number of
edges, no external library needed.

**Q — Sibulan Airport is outside the polygon. How is it bookable?**
Through a named exception: the app's own curated pickup points are trusted within
about 400 m, regardless of the polygon. Loosening the boundary to include the
airport would also admit unrelated parts of Sibulan. An explicit exception is
honest and auditable; a distorted boundary is neither.

**Q — Why proxy the geocoder through your own server?**
The providers require an identifying User-Agent that browsers refuse to set;
their fair-use limits can only be enforced centrally; and a shared 30-minute
cache means many passengers searching the same landmark cost one request.

**Q — How does it avoid sending someone to the wrong place with a similar name?**
Confidence alone was not enough — "Foundation University" scored above the floor
against *Silliman* University on the shared word. So matches also report
coverage, the fraction of the passenger's words a place explains; below 0.6 the
geocoder is consulted instead. And when two places match comparably, the system
asks rather than choosing.

**Q — What if the passenger names a place that isn't mapped?**
Gently asks them to describe it another way — a street, a nearby landmark, the
full business name. Streets are well covered in OSM, so that recovery usually
works. The map pin remains the final fallback.

### On fares and scope

**Q — Why does a 1.12 km trip cost ₱17 and not ₱15?**
Because the ordinance charges each succeeding kilometre "or fraction thereof".
The first kilometre is covered by the ₱15 base; the remaining 0.12 km is a
fraction, which rounds up to one whole kilometre at ₱2.

**Q — Why is there an epsilon in the fare calculation?**
To protect the exact boundary. A 2.000 km trip should bill one succeeding
kilometre, but floating-point subtraction can leave a value a hair above 1, and
`Math.ceil` would round it to 2 — overcharging by a full kilometre. Subtracting
1e-9 first makes that boundary resolve in the passenger's favour.

**Q — Why doesn't the app apply the 20% discount automatically?**
Because it cannot verify the ID that entitles someone to it. Granting a discount
on an unverified claim creates a dispute at the end of the ride. Gently states
the entitlement plainly and explains that the quoted figure is the full fare to
be arranged with the driver.

**Q — Why is pakyaw a flat fare rather than per passenger?**
Because it hires the vehicle, not a seat. The computed ₱70 + ₱5/km is a
*minimum*, not a price — the passenger offers at or above it and the driver
accepts or passes. That is also why the vehicle is exclusive: pooling anyone else
in would sell the same seats twice.

**Q — Why can't I book a trip to Valencia or Dauin?**
Not unwillingness to drive there — each municipality sets its own fare matrix, so
the Dumaguete ordinance the app implements has no authority outside the city.
Rather than refusing, the system offers the correct onward journey and mentions a
pakyaw charter, which needs no tariff because the price is negotiated.

### On process and judgement

**Q — What was the hardest bug?**
The Valencia bug, because it failed *confidently*. Fuzzy matching scored the town
"Valencia" against the downtown "Valencia Jeepney & Bus Terminal" and quoted ₱17
for a 1.14 km trip, then offered to book it — a passenger could have confirmed
believing they were going 9 km up the mountain. It taught the principle the rest
of the resolution layer follows: when a system is unsure, it must say so rather
than pick.

**Q — Give an example of something you chose not to build.**
Road-aware detour ordering. It was measured rather than assumed: routing every
candidate through OSRM improved ordering by about 1.2% while adding a
2.2-second API call to every queue refresh. The straight-line approximation with
a 1.32 road factor was kept. Measuring before optimising is the point.

**Q — How do you know the system actually works?**
Six offline suites covering fare arithmetic, pooling and sequencing, polygon
membership, chat, the cancel race, and the full agent loop — all runnable on
every change for nothing, because the dispatch logic is pure functions and the AI
has a mock provider. The security claim was tested directly by attempting an
unauthenticated booking with an injected passenger id, which was rejected.

**Q — What would you do next, with more time?**
Authentication on the driver and ride endpoints, first and without argument. Then
trip event logging for auditability, GCash payment, and giving Gently the
passenger's live location — built but not wired, and costing about 20 tokens a
message.

---

## 14. The night-before sheet

### Five sentences that answer half the questions

1. **The system computes, the model proposes, the human commits** — no fare comes
   from the LLM and no booking happens without a tap.
2. **Tier filtering happens in SQL, not in the prompt**, because a retrieved ₱9 is
   more persuasive than an instruction to ignore it.
3. **Dispatch ranks by detour and never hides on-the-way trips**, because hiding
   emptied the queue and broke pooling.
4. **The city boundary exists because each municipality has its own fare matrix**,
   not because drivers won't travel.
5. **When the system is unsure which place you mean, it asks** — silently picking
   is how the Valencia bug happened.

### Numbers to have ready

| Fact | Value |
|---|---:|
| Pedicab base / per km | ₱15 / ₱2 |
| Pakyaw base / per km | ₱70 / ₱5 (flat) |
| Knowledge chunks / embedded | 2,404 / 2,404 |
| Tier split (official / local / reference) | 26 / 2,107 / 271 |
| Embedding dimensions | 1,536 |
| Chunks retrieved per question | 4 |
| Along-the-way badge / hide threshold | 0.8 km / 3 km |
| Boundary polygon points | 165 |
| Total API spend | ≈ $0.04 of $50 |

### If you are asked something you don't know

Say so, then say where the answer lives — *"that's in `shared/dispatch.ts`, I'd
want to check the constant rather than guess."* Knowing the shape of your own
system reads as competence. Inventing a number does not, and it is the one
mistake this whole project was designed to avoid.
