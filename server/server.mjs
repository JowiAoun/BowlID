// Serves web/ and POST /verdict. Holds the API key so the browser never sees it.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { pickCanned } from "../web/canned.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "..", "web");
const PORT = Number(process.env.PORT || 5173);
const MODEL = process.env.VERDICT_MODEL || "claude-haiku-5-5";
const TIMEOUT_MS = Number(process.env.VERDICT_TIMEOUT_MS || 2500);
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const client = HAS_KEY ? new Anthropic({ maxRetries: 0, timeout: TIMEOUT_MS }) : null;
const canned = JSON.parse(await fs.readFile(path.join(WEB, "canned.json"), "utf8"));

const SYSTEM = `You are HUMANCHECK, a paranoid CAPTCHA that suspects every user is a robot.
A volunteer is doing a physical challenge on stage in front of a live audience. You get:
- stage: which challenge they just did
- verdict: PASS or FAIL. This is already decided. Never change it, never hedge it.
- variant: extra context for the verdict (e.g. too_still vs trembling)
- input: how they did it (wiimote, webcam, or mouse; mocking a mouse user is encouraged)
- features: real measurements of their motion

Feature meanings: peakForce = strongest acceleration in g (1 g is resting; a real bowling swing is 2-5 g).
duration = ms the motion lasted. hesitation = ms they waited before moving. tremor = jitter while
supposed to be still (0 is impossibly still, above 0.05 is shaky). reversals = direction changes.
micPeak = loudest sound, 0 to 1.

Write ONE deadpan sentence, at most 22 words, that justifies the verdict by roasting one or two
specific numbers. Spoken aloud by text-to-speech, so no emojis, no markdown, no quotes, write numbers
the way they should be read. Family-friendly. Funny beats accurate. End with the verdict implied or stated.`;

async function claudeVerdict(req) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 120, // one short sentence
    system: SYSTEM,
    thinking: { type: "disabled" }, // latency matters more than depth here
    output_config: { effort: "low" },
    messages: [{ role: "user", content: JSON.stringify(req) }],
  });
  if (msg.stop_reason === "refusal") throw new Error("refusal");
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("empty");
  return text;
}

async function handleVerdict(body) {
  const { stage, outcome, variant, features = {}, input } = body;
  const v = variant || outcome;
  const req = { stage, verdict: outcome === "pass" ? "PASS" : "FAIL", variant: v, input, features };
  if (client) {
    const t0 = Date.now();
    try {
      const line = await claudeVerdict(req);
      console.log(`[claude ${Date.now() - t0}ms] ${stage}/${v}: ${line}`);
      return { line, source: "claude" };
    } catch (err) {
      console.warn(`[claude failed after ${Date.now() - t0}ms] ${err?.status ?? ""} ${err?.message}`);
    }
  }
  return { line: pickCanned(canned, stage, v, features), source: "canned" };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "POST" && url.pathname === "/verdict") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      return send(res, 200, await handleVerdict(JSON.parse(raw || "{}")));
    }
    if (url.pathname === "/health") return send(res, 200, { claude: HAS_KEY, model: MODEL });

    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep)) return send(res, 403, "forbidden", "text/plain");
    const data = await fs.readFile(file);
    send(res, 200, data, MIME[path.extname(file)] || "application/octet-stream");
  } catch (err) {
    if (err.code === "ENOENT") return send(res, 404, "not found", "text/plain");
    console.error(err);
    send(res, 500, { error: String(err.message) });
  }
});

server.listen(PORT, () => {
  console.log(`Proof of Human on http://localhost:${PORT}`);
  console.log(HAS_KEY ? `Verdicts: ${MODEL}, ${TIMEOUT_MS}ms timeout, canned fallback` : "Verdicts: canned only (no ANTHROPIC_API_KEY)");
});
