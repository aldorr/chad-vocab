import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, migrate, resolvePath } from "./db/index.js";
import { authRoutes } from "./routes/auth.js";
import { cardRoutes } from "./routes/cards.js";
import { deckRoutes } from "./routes/decks.js";
import { practiceRoutes } from "./routes/practice.js";
import { speechRoutes } from "./routes/speech.js";
import type { AuthVars } from "./lib/auth.js";

// Load .env from repo root if present (simple parser, no dotenv dep required)
function loadEnv() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../"
  );
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv();
migrate();

const audioDir = resolvePath(process.env.AUDIO_DIR || "./data/audio");
fs.mkdirSync(audioDir, { recursive: true });

const app = new Hono<{ Variables: AuthVars }>();

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: (origin) => origin || "http://localhost:5173",
    credentials: true,
  })
);

app.get("/api/health", async (c) => {
  const scriberrUrl = process.env.SCRIBERR_URL || "http://127.0.0.1:8080";
  const lmUrl = process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1";
  let scriberr = false;
  let lmStudio = false;
  try {
    const r = await fetch(`${scriberrUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    scriberr = r.ok;
  } catch {
    scriberr = false;
  }
  try {
    const r = await fetch(`${lmUrl.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(2000),
    });
    lmStudio = r.ok;
  } catch {
    lmStudio = false;
  }
  return c.json({
    ok: true,
    scriberr,
    lmStudio,
    inviteRequired: Boolean(process.env.INVITE_CODE?.trim()),
  });
});

app.route("/api/auth", authRoutes);
app.route("/api/decks", deckRoutes);
app.route("/api/cards", cardRoutes);
app.route("/api/practice", practiceRoutes);
app.route("/api/speech", speechRoutes);

const clientDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../client/dist"
);

if (fs.existsSync(clientDist)) {
  app.use("/*", serveStatic({ root: clientDist }));
  app.get("*", async (c) => {
    const index = path.join(clientDist, "index.html");
    return c.html(fs.readFileSync(index, "utf8"));
  });
}

const port = Number(process.env.PORT || 3001);
console.log(`Family Vocab API on http://localhost:${port}`);
void db;
serve({ fetch: app.fetch, port });
