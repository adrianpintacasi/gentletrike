import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { api } from "./server/routes";

const app = express();
// Hosts (Render, Railway, Fly, Cloud Run) inject the port they expect us to bind.
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Rides, drivers, chat and TMO reports — the shared state every device reads.
app.use("/api", api);

// Initialize Gemini client server-side
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Gemini AI Local Gentle Assistant Endpoint
app.post("/api/dumaguete/ai-assistant", async (req, res) => {
  try {
    const { prompt, pickup, dropoff, vehicleType } = req.body;

    if (!apiKey || !ai) {
      return res.status(200).json({
        reply: `GentleTrike Gentle Assistant (Local Offline Mode):\nFor trips between ${pickup || 'your location'} and ${dropoff || 'your destination'} in Dumaguete City, the standard Pedicab base fare is ₱15 for the first kilometer (₱2 per additional km). Special pakyaw rates apply for out-of-town routes like Valencia or Sibulan Airport!`,
      });
    }

    const systemInstruction = `You are "Gently", the friendly local Dumaguete City ride & transport assistant for GentleTrike (Dumaguete's premier public hailing app). Refer to yourself as Gently.
Dumaguete City is known as the "City of Gentle People" in Negros Oriental, Philippines.
Key local transport modes:
1. Pedicab (Motorcab / Motorized Tricycle) - The iconic 3-wheeled transport of Dumaguete. Standard fare: ₱15 for the first 1km or less, then ₱2 for every succeeding km OR FRACTION THEREOF (so 1.01km-2.00km = ₱17, 2.01km-3.00km = ₱19). Distances are actual road distances. Student/senior discount applies (20%).
2. E-Trike / Premium Motorcab - Eco-friendly electric tricycle, smooth and spacious.
3. Habal-Habal (Motorcycle Taxi) - Quick solo rides through traffic.
4. Multicab (EasyRide) - Shared routes to Valencia, Sibulan, Bacong, and San Jose.
5. DumaPabili / Express - Food and errand delivery (Sans Rival Silvanas, Painitan sa Tiangge budbud & tsokolate, Jo's Inato, Hukad, etc.).

When answering the user:
- Be warm, welcoming, polite, and helpful ("Maayong adlaw!", "Daghang salamat!").
- Give practical, accurate Dumaguete fare estimates or route suggestions.
- Mention real Dumaguete landmarks (Rizal Boulevard, Silliman University, Port Pier 1, Sibulan Airport, Robinsons Place, Public Market Tiangge, Lee Super Plaza, Valencia).
- Keep answers concise (2-4 paragraphs max) with clear formatting.`;

    const userMessage = prompt
      ? prompt
      : `What is the estimated fare and recommended way to get from "${pickup || 'Rizal Boulevard'}" to "${dropoff || 'Silliman University'}" using ${vehicleType || 'Pedicab'} in Dumaguete City?`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userMessage,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    return res.json({ reply: response.text || "Safe travels around Dumaguete City!" });
  } catch (err: any) {
    console.error("Gemini API Error:", err);
    return res.status(500).json({
      error: "Failed to query DumaRide AI Assistant",
      details: err.message,
    });
  }
});

async function startServer() {
  // Registered after every real /api route, but before the SPA fallbacks below.
  // Without this an unmatched API path falls through to the HTML shell — in dev
  // to Vite's middleware, in production to the catch-all — and the client ends
  // up trying to JSON.parse a page.
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
