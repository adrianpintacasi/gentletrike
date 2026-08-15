import "dotenv/config";
import express from "express";
import * as path from "path";
import { createServer as createViteServer } from "vite";
import { api } from "./server/routes";
import { initDb } from "./server/db";
import { placeAtPoint } from "./server/geocode";
import { runAgent } from "./server/ai/agent";
import { createProvider, type LlmProvider } from "./server/ai/provider";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "5mb" })); // headroom for a base64 rider photo

// Shared state for rides, drivers, chat, and TMO reports
app.use("/api", api);

// Gently's language model. Falls back to a deterministic mock when no API key
// is configured, so the assistant keeps working (and costs nothing) in dev.
const gently: LlmProvider = createProvider();

// legal_context.txt is no longer pasted into every prompt — it is ingested into
// the kb_chunks table by `npm run ingest` and retrieved per question instead.

/**
 * Prior turns are attacker-influenced input: the client decides what to send,
 * and a crafted payload could otherwise inject `system` messages or an
 * unbounded transcript. Keep only the two roles a passenger can legitimately
 * produce, cap each turn's length, and cap how many turns reach the model.
 */
const MAX_HISTORY_TURNS = 6;
const MAX_TURN_CHARS = 1500;

type ChatTurn = { role: "user" | "assistant"; content: string };

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (t): t is { role: string; text: string } =>
        !!t && typeof t === "object" && typeof (t as any).text === "string"
    )
    .filter((t) => t.role === "user" || t.role === "assistant")
    .filter((t) => t.text.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.text.slice(0, MAX_TURN_CHARS),
    }));
}

app.post("/api/dumaguete/ai-assistant", async (req, res) => {
  try {
    const { prompt, pickup, dropoff, vehicleType } = req.body;
    const history = sanitizeHistory(req.body?.history);

    // Where the passenger is standing. Gently resolves place names through the
    // same search the booking panel uses, and that search is biased by position
    // — so without this, "the university" is answered from the words alone and
    // can land in a different province from the person asking.
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const near =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;

    /*
     * Where the passenger is, in words — but only when it is going to be used.
     *
     * Coordinates let Gently search correctly but not speak, so a reverse lookup
     * turns "10.2949, 123.8811" into "Cebu Institute of Technology". The catch is
     * that it is a network round trip sitting in front of the model, and most
     * questions name both ends of the trip and never need it. Paying for it on
     * every message added a visible pause to every reply.
     *
     * So it runs only when the message actually leans on where the passenger is,
     * and it is capped: a slow lookup must not hold up an answer that would have
     * been fine without it.
     */
    const raw = String(prompt ?? '').toLowerCase();
    const needsPlaceName =
      /\b(here|near me|nearby|around me|where am i|my location|current location|closest|nearest)\b/.test(
        raw
      );

    const nearName =
      near && needsPlaceName
        ? await Promise.race([
            placeAtPoint(near.lat, near.lng).then((p) => p?.name ?? null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
          ]).catch(() => null)
        : null;

    const userMessage = String(prompt ?? "").trim()
      ? String(prompt).slice(0, MAX_TURN_CHARS)
      : `What is the fare and best way to get from "${pickup || "Rizal Boulevard"}" to "${
          dropoff || "Silliman University"
        }" using ${vehicleType || "a pedicab"}?`;

    const result = await runAgent(gently, userMessage, history, {
      pickup,
      dropoff,
      near,
      nearName,
      // Only wired when the provider can embed; retrieval falls back to keyword
      // search otherwise, which keeps the mock path free.
      embed: gently.embed
        ? async (text: string) => (await gently.embed!([text]))[0]
        : undefined,
    });

    return res.json({
      reply: result.reply,
      // The UI reads `data` for the booking draft that the Confirm button submits.
      data: result.data,
      meta: { provider: result.provider, toolsUsed: result.toolsUsed, usage: result.usage },
    });
  } catch (err: any) {
    console.error("Gently assistant error:", err);
    return res.status(500).json({
      error: "Gently could not answer that right now",
      details: err.message,
    });
  }
});

/**
 * Connect + run migrations, retrying with backoff. Neon's free tier can be slow
 * (or briefly unreachable) to wake from idle, so a single failed attempt should
 * not take the whole app down.
 */
async function initDbWithRetry(attempts = 6): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await initDb();
      console.log("Database ready.");
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Database not ready (attempt ${i}/${attempts}): ${msg}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, Math.min(2000 * i, 10000)));
    }
  }
  console.error(
    "Could not reach the database after several attempts. The web server is up, " +
      "but sign-in and data won't work until the database is reachable. Check your " +
      "internet connection and the Neon database status, then restart."
  );
}

async function startServer() {
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Open the port first so http://localhost:PORT loads right away, then bring the
  // database up in the background (with retries) instead of blocking startup.
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`GentleTrike Dumaguete Server running on http://localhost:${PORT}`);
    console.log("Connecting to the database...");
  });

  await initDbWithRetry();
}

startServer();