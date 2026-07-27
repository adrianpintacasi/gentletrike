import "dotenv/config";
import express from "express";
import * as path from "path";
import * as fs from "fs";
import OpenAI from "openai";
import { createServer as createViteServer } from "vite";
import { api } from "./server/routes";
import { initDb } from "./server/db";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "5mb" })); // headroom for a base64 rider photo

// Shared state for rides, drivers, chat, and TMO reports
app.use("/api", api);

// Initialize OpenAI client
const apiKey = process.env.OPENAI_API_KEY;
let openai: OpenAI | null = null;

if (apiKey) {
  console.log("OpenAI API Key detected! Initializing OpenAI client...");
  openai = new OpenAI({ apiKey });
} else {
  console.warn("WARNING: OPENAI_API_KEY is missing from process.env!");
}

// Load RAG Legal Knowledge Base from server/data/legal_context.txt
let legalContext = "";
try {
  const contextPath = path.join(process.cwd(), "server", "data", "legal_context.txt");
  if (fs.existsSync(contextPath)) {
    legalContext = fs.readFileSync(contextPath, "utf-8");
    console.log("Successfully loaded legal_context.txt for Gently RAG.");
  } else {
    console.warn("Warning: legal_context.txt not found at " + contextPath);
  }
} catch (err) {
  console.error("Error loading legal_context.txt:", err);
}

// OpenAI Local Gentle Assistant Endpoint
app.post("/api/dumaguete/ai-assistant", async (req, res) => {
  try {
    const { prompt, pickup, dropoff, vehicleType } = req.body;

    if (!apiKey || !openai) {
      return res.status(200).json({
        reply: `GentleTrike Gentle Assistant (Local Offline Mode):\nFor trips between ${pickup || 'your location'} and ${dropoff || 'your destination'} in Dumaguete City, the standard Pedicab base fare is ₱15 for the first kilometer (₱2 per additional km). Special pakyaw rates apply for out-of-town routes like Valencia or Sibulan Airport!`,
      });
    }

    const systemInstruction = `You are "Gently", the friendly local Dumaguete City ride & transport assistant for GentleTrike (Dumaguete's premier public hailing app). Refer to yourself as Gently.
Dumaguete City is known as the "City of Gentle People" in Negros Oriental, Philippines.

=== LEGAL, FARE, AND ORDINANCE KNOWLEDGE BASE ===
${legalContext}
==================================================

Key local transport modes:
1. Pedicab (Motorcab / Motorized Tricycle) - Standard fare: ₱15 for the first 1km or less, then ₱2 for every succeeding km OR FRACTION THEREOF. Student/senior/PWD discount applies (20%).
2. E-Trike / Premium Motorcab - Eco-friendly electric tricycle.
3. Habal-Habal (Motorcycle Taxi) - Quick solo rides.
4. Multicab (EasyRide) - Shared routes to Valencia, Sibulan, Bacong, and San Jose.
5. DumaPabili / Express - Food and errand delivery.

When answering the user:
- Be warm, welcoming, polite, and helpful ("Maayong adlaw!", "Daghang salamat!").
- FARE CALCULATION RULE: Use strict round-up (ceiling) math for pedicabs! Any fraction of a kilometer past 1.0 km rounds UP to the full ₱2 (e.g., 1.1 km to 2.0 km = ₱17, 2.1 km to 3.0 km = ₱19). Never multiply fractions by ₱2!
- Use the knowledge base above to answer legal liability, ordinance, discount, or TMO reporting questions accurately.
- Mention that formal complaints to TMO require personal appearance by the complainant.
- Keep answers concise (2-4 paragraphs max) with clear formatting.`;

    const userMessage = prompt
      ? prompt
      : `What is the estimated fare and recommended way to get from "${pickup || 'Rizal Boulevard'}" to "${dropoff || 'Silliman University'}" using ${vehicleType || 'Pedicab'} in Dumaguete City?`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || "Safe travels around Dumaguete City!";
    return res.json({ reply });
  } catch (err: any) {
    console.error("OpenAI API Error:", err);
    return res.status(500).json({
      error: "Failed to query DumaRide AI Assistant",
      details: err.message,
    });
  }
});

async function startServer() {
  await initDb();

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`GentleTrike Dumaguete Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();