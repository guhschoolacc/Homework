import "dotenv/config";
import express from "express";
import OpenAI, { toFile } from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is not set in your .env file.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AI_SYSTEM = `You are VEXIS, an AI assistant on homewrk 3.0. Talk like a normal, chill person. Be helpful, direct, and conversational. Don't be overly dramatic or poetic. Just help people out with whatever they need, like a smart friend would.`;

const JARVIS_SYSTEM = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), Tony Stark's AI assistant from Iron Man. Speak with a refined British butler tone — calm, precise, occasionally dry wit. Keep all responses concise: 1–3 sentences unless detail is essential. Occasionally address the user as "sir" or "ma'am". Stay in character always. Answer real-world questions accurately while maintaining the JARVIS persona.`;

// ── CSP ───────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy",
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
    "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
    "connect-src * data: blob:; " +
    "img-src * data: blob:; " +
    "style-src * 'unsafe-inline'; " +
    "font-src * data:;"
  );
  next();
});

// ── Middleware + static ───────────────────────────────────────────────────────
app.use(express.json({ limit: "25mb" }));
// public/ first so index.html is served at /, then root for games/, apps/, images/, etc.
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname)));

// ── GET /api/pollinations ─────────────────────────────────────────────────────
app.get("/api/pollinations", async (req, res) => {
  const { prompt, model = "flux", width = "1024", height = "1024", seed } = req.query;
  if (!prompt) return res.status(400).json({ error: "prompt is required." });

  const safeModels = ["flux", "turbo", "flux-realism", "flux-anime", "flux-3d", "any"];
  const safeModel = safeModels.includes(model) ? model : "flux";
  const safeW = Math.min(parseInt(width) || 1024, 1792);
  const safeH = Math.min(parseInt(height) || 1024, 1792);
  const safeSeed = parseInt(seed) || Math.floor(Math.random() * 999999);

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${safeModel}&width=${safeW}&height=${safeH}&nologo=true&seed=${safeSeed}`;

  try {
    const upstream = await fetch(url, {
      headers: { "Accept": "image/jpeg,image/png,image/webp,*/*", "User-Agent": "homewrk/3.0" },
      signal: AbortSignal.timeout(60000),
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Pollinations returned ${upstream.status}` });
    }
    const contentType = upstream.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err) {
    console.error("Pollinations proxy error:", err.message);
    res.status(502).json({ error: err.message || "Pollinations request failed." });
  }
});

// ── POST /api/imagegen ────────────────────────────────────────────────────────
app.post("/api/imagegen", async (req, res) => {
  const { prompt, size = "1024x1024", quality = "standard" } = req.body;

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required." });
  }

  const allowedSizes = ["1024x1024", "1792x1024", "1024x1792"];
  const safeSize = allowedSizes.includes(size) ? size : "1024x1024";

  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: prompt.trim(),
      n: 1,
      size: safeSize,
      quality,
    });

    const imageUrl = response.data[0].url;
    const revisedPrompt = response.data[0].revised_prompt || prompt;
    return res.json({ url: imageUrl, revised_prompt: revisedPrompt });
  } catch (err) {
    console.error("Image gen error:", err.message);
    return res.status(err.status || 500).json({ error: err.message || "Image generation failed." });
  }
});

// ── POST /api/imageedit ───────────────────────────────────────────────────────
app.post("/api/imageedit", async (req, res) => {
  const { prompt, imageBase64, mimeType = "image/png", size = "1024x1024" } = req.body;

  if (!prompt || !imageBase64) {
    return res.status(400).json({ error: "prompt and imageBase64 are required." });
  }

  const allowedSizes = ["1024x1024", "1792x1024", "1024x1792"];
  const safeSize = allowedSizes.includes(size) ? size : "1024x1024";

  try {
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const imageFile = await toFile(imageBuffer, "image.png", { type: mimeType });

    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt: prompt.trim(),
      n: 1,
      size: safeSize,
    });

    const b64 = response.data[0].b64_json;
    const url = response.data[0].url || null;
    return res.json({ b64_json: b64, url });
  } catch (err) {
    console.error("Image edit error:", err.message);
    return res.status(err.status || 500).json({ error: err.message || "Image edit failed." });
  }
});

// ── POST /api/chat ────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required." });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      max_tokens: 1024,
      messages: [{ role: "system", content: AI_SYSTEM }, ...messages],
    });

    return res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return res.status(err.status || 500).json({ error: err.message || "OpenAI request failed." });
  }
});

// ── POST /api/jarvis ──────────────────────────────────────────────────────────
app.post("/api/jarvis", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required." });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      max_tokens: 300,
      messages: [{ role: "system", content: JARVIS_SYSTEM }, ...messages],
    });

    return res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error("Jarvis error:", err.message);
    return res.status(err.status || 500).json({ error: err.message || "Request failed." });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  homewrk backend running on port ${PORT}`);
});
