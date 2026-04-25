import "dotenv/config";
import express from "express";
import OpenAI from "openai";
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

// ── CSP must come FIRST, before static serving ───────────────────────────────
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

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname)));

// ── POST /api/imagegen ───────────────────────────────────────────────────────
app.post("/api/imagegen", async (req, res) => {
  const { prompt, size = "1024x1024", quality = "standard" } = req.body;

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required." });
  }

  const allowedSizes = ["1024x1024", "1792x1024", "1024x1792"];
  const safeSize = allowedSizes.includes(size) ? size : "1024x1024";

  try {
    const response = await openai.images.generate({
      model: "gpt-image-1.5",
      prompt: prompt.trim(),
      n: 1,
      size: safeSize,
      quality,
      response_format: "url",
    });

    const imageUrl = response.data[0].url;
    const revisedPrompt = response.data[0].revised_prompt || prompt;
    return res.json({ url: imageUrl, revised_prompt: revisedPrompt });
  } catch (err) {
    console.error("DALL-E error:", err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "Image generation failed." });
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

    const reply = completion.choices[0].message.content;
    return res.json({ reply });
  } catch (err) {
    console.error("OpenAI error:", err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "OpenAI request failed." });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  homewrk backend running at http://localhost:${PORT}`);
});
