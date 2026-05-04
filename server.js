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
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname)));

// ── POST /api/imagegen ───────────────────────────────────────────────────────
app.post("/api/imagegen", async (req, res) => {
  const { prompt, size = "1024x1024", quality = "standard", model = "dall-e-3" } = req.body;

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required." });
  }

  const allowedSizes = ["1024x1024", "1792x1024", "1024x1792"];
  const safeSize = allowedSizes.includes(size) ? size : "1024x1024";

  // gpt-image-1 and gpt-image-1.5 return b64_json, dall-e-3 returns url
  const useGptImage = model === "gpt-image-1" || model === "gpt-image-1.5";
  const safeModel = useGptImage ? model : "dall-e-3";

  try {
    const genParams = {
      model: safeModel,
      prompt: prompt.trim(),
      n: 1,
      size: safeSize,
    };
    if (!useGptImage) genParams.quality = quality;

    const response = await openai.images.generate(genParams);

    if (useGptImage) {
      const b64 = response.data[0].b64_json;
      return res.json({ b64, revised_prompt: prompt });
    } else {
      const imageUrl = response.data[0].url;
      const revisedPrompt = response.data[0].revised_prompt || prompt;
      return res.json({ url: imageUrl, revised_prompt: revisedPrompt });
    }
  } catch (err) {
    console.error("Image gen error:", err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "Image generation failed." });
  }
});

// ── POST /api/imageedit ──────────────────────────────────────────────────────
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

    // gpt-image-1 returns b64_json
    const b64 = response.data[0].b64_json;
    const url = response.data[0].url || null;
    return res.json({ b64, url, revised_prompt: prompt });
  } catch (err) {
    console.error("Image edit error:", err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "Image edit failed." });
  }
});

// ── POST /api/chat ────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, model } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required." });
  }

  // Only allow gpt-4o for now; ignore any other model sent
  const safeModel = "gpt-4o";

  try {
    const completion = await openai.chat.completions.create({
      model: safeModel,
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
