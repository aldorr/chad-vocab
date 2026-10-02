import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { db, resolvePath } from "../db/index.js";
import { cards } from "../db/schema.js";
import { requireAuth, type AuthVars } from "../lib/auth.js";
import { extractPairsFromImage } from "../lib/lmstudio.js";
import { contentTypeForAudioPath } from "../lib/speechAudio.js";

export const cardRoutes = new Hono<{ Variables: AuthVars }>();

cardRoutes.use("*", requireAuth);

type AudioSide = "answer" | "prompt";

function audioDir(): string {
  return resolvePath(process.env.AUDIO_DIR || "./data/audio");
}

function isSide(s: string): s is AudioSide {
  return s === "answer" || s === "prompt";
}

function publicCard(row: typeof cards.$inferSelect) {
  return {
    id: row.id,
    answer: row.answer,
    prompt: row.prompt,
    hasAnswerAudio: Boolean(row.answerAudioPath),
    hasPromptAudio: Boolean(row.promptAudioPath),
    status: row.status,
    streak: row.streak,
    seen: row.seen,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

export async function getProgress(userId: string) {
  const rows = await db
    .select()
    .from(cards)
    .where(eq(cards.userId, userId))
    .all();
  const total = rows.length;
  const learned = rows.filter((r) => r.status === "learned").length;
  const practice = rows.filter((r) => r.status === "practice").length;
  const fresh = rows.filter((r) => r.status === "new").length;
  const unlearned = total - learned;
  return { total, learned, practice, new: fresh, unlearned };
}

cardRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(cards)
    .where(eq(cards.userId, user.id))
    .all();
  return c.json({ cards: rows.map(publicCard) });
});

cardRoutes.get("/stats/progress", async (c) => {
  const user = c.get("user");
  const progress = await getProgress(user.id);
  return c.json({
    ...progress,
    pointsTotal: user.pointsTotal,
  });
});

cardRoutes.post("/import", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ text?: string }>();
  const text = body.text ?? "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const existing = await db
    .select()
    .from(cards)
    .where(eq(cards.userId, user.id))
    .all();
  const key = (answer: string, prompt: string) =>
    `${answer.toLowerCase()}|${prompt.toLowerCase()}`;
  const seen = new Set(existing.map((r) => key(r.answer, r.prompt)));

  let added = 0;
  let skipped = 0;
  const now = Date.now();

  for (const line of lines) {
    const parts = line.includes("|")
      ? line.split("|")
      : line.includes("\t")
        ? line.split("\t")
        : line.split(",");
    if (parts.length < 2) {
      skipped++;
      continue;
    }
    const answer = parts[0]!.trim();
    const prompt = parts.slice(1).join(",").trim();
    if (!answer || !prompt) {
      skipped++;
      continue;
    }
    const k = key(answer, prompt);
    if (seen.has(k)) {
      skipped++;
      continue;
    }
    seen.add(k);
    await db.insert(cards).values({
      id: nanoid(),
      userId: user.id,
      answer,
      prompt,
      answerAudioPath: null,
      promptAudioPath: null,
      status: "new",
      streak: 0,
      seen: 0,
      updatedAt: now,
      createdAt: now,
    });
    added++;
  }

  return c.json({ added, skipped });
});

/** Preview-only: extract vocab pairs from a textbook photo via Gemma vision. */
cardRoutes.post("/from-photo", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const file = form["image"] ?? form["photo"] ?? form["file"];

  if (!file || !(file instanceof File)) {
    return c.json({ error: "image file required (JPEG or PNG)" }, 400);
  }

  const mime = (file.type || "image/jpeg").toLowerCase();
  if (mime && !mime.startsWith("image/") && mime !== "application/octet-stream") {
    return c.json({ error: "File must be an image (JPEG or PNG preferred)" }, 400);
  }
  if (
    mime.includes("heic") ||
    mime.includes("heif") ||
    mime.includes("webp") ||
    mime.includes("avif")
  ) {
    return c.json(
      {
        error:
          "Please use JPEG or PNG. The browser usually converts camera photos automatically — if this persists, take a screenshot of the page instead.",
      },
      400
    );
  }

  const maxBytes = 12 * 1024 * 1024;
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > maxBytes) {
    return c.json({ error: "Image too large (max 12MB)" }, 400);
  }
  if (buf.length < 32) {
    return c.json({ error: "Image file is empty" }, 400);
  }

  // Sniff real format — browsers sometimes lie about HEIC as image/jpeg
  const head = buf.subarray(0, 12);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const isPng =
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47;
  if (!isJpeg && !isPng) {
    return c.json(
      {
        error:
          "Image isn’t a JPEG/PNG after upload. Try a screenshot or export as JPEG, then scan again.",
      },
      400
    );
  }

  const result = await extractPairsFromImage({
    base64: buf.toString("base64"),
    mime: isPng ? "image/png" : "image/jpeg",
    promptLang: user.promptLang,
    answerLang: user.answerLang,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 502);
  }

  return c.json({
    pairs: result.pairs,
    langs: { promptLang: user.promptLang, answerLang: user.answerLang },
  });
});

cardRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, user.id)))
    .get();
  if (!row) return c.json({ error: "Not found" }, 404);
  for (const rel of [row.answerAudioPath, row.promptAudioPath]) {
    if (!rel) continue;
    const full = path.join(audioDir(), rel);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
  await db
    .delete(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, user.id)));
  return c.json({ ok: true });
});

cardRoutes.post("/:id/audio/:side", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const side = c.req.param("side");
  if (!isSide(side)) return c.json({ error: "side must be answer|prompt" }, 400);

  const row = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, user.id)))
    .get();
  if (!row) return c.json({ error: "Not found" }, 404);

  const form = await c.req.parseBody();
  const file = form["audio"];
  if (!file || !(file instanceof File)) {
    return c.json({ error: "audio file required" }, 400);
  }

  const userDir = path.join(audioDir(), user.id);
  fs.mkdirSync(userDir, { recursive: true });
  const rel = path.join(user.id, `${id}-${side}.webm`);
  const full = path.join(audioDir(), rel);
  fs.writeFileSync(full, Buffer.from(await file.arrayBuffer()));

  const prev = side === "answer" ? row.answerAudioPath : row.promptAudioPath;
  if (prev && prev !== rel) {
    const old = path.join(audioDir(), prev);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  await db
    .update(cards)
    .set(
      side === "answer"
        ? { answerAudioPath: rel, updatedAt: Date.now() }
        : { promptAudioPath: rel, updatedAt: Date.now() }
    )
    .where(eq(cards.id, id));

  return c.json({
    ok: true,
    hasAnswerAudio: side === "answer" ? true : Boolean(row.answerAudioPath),
    hasPromptAudio: side === "prompt" ? true : Boolean(row.promptAudioPath),
  });
});

cardRoutes.get("/:id/audio/:side", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const side = c.req.param("side");
  if (!isSide(side)) return c.json({ error: "side must be answer|prompt" }, 400);

  const row = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, user.id)))
    .get();
  const rel = side === "answer" ? row?.answerAudioPath : row?.promptAudioPath;
  if (!rel) return c.json({ error: "No audio" }, 404);
  const full = path.join(audioDir(), rel);
  if (!fs.existsSync(full)) return c.json({ error: "Missing file" }, 404);
  return new Response(fs.readFileSync(full), {
    headers: {
      "Content-Type": contentTypeForAudioPath(rel),
      "Cache-Control": "private, max-age=3600",
    },
  });
});

cardRoutes.delete("/:id/audio/:side", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const side = c.req.param("side");
  if (!isSide(side)) return c.json({ error: "side must be answer|prompt" }, 400);

  const row = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, user.id)))
    .get();
  if (!row) return c.json({ error: "Not found" }, 404);

  const rel = side === "answer" ? row.answerAudioPath : row.promptAudioPath;
  if (rel) {
    const full = path.join(audioDir(), rel);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }

  await db
    .update(cards)
    .set(
      side === "answer"
        ? { answerAudioPath: null, updatedAt: Date.now() }
        : { promptAudioPath: null, updatedAt: Date.now() }
    )
    .where(eq(cards.id, id));

  return c.json({ ok: true });
});
