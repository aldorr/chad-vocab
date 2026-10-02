import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { decks, sessions, users } from "../db/schema.js";
import {
  clearSessionCookie,
  createSession,
  hashPassword,
  publicUser,
  requireAuth,
  setSessionCookie,
  verifyPassword,
  type AuthVars,
} from "../lib/auth.js";
import { createDeckForUser, ensureActiveDeck, setActiveDeck } from "../lib/decks.js";
import {
  langCodeForLabel,
  listVoicesForLanguage,
  validateApiKey,
} from "../lib/elevenlabs.js";
import { decryptSecret, encryptSecret, keyHint } from "../lib/secret.js";

export const authRoutes = new Hono<{ Variables: AuthVars }>();

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<{
    username?: string;
    password?: string;
    inviteCode?: string;
    promptLang?: string;
    answerLang?: string;
  }>();
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const promptLang = (body.promptLang?.trim() || "German").slice(0, 40);
  const answerLang = (body.answerLang?.trim() || "Spanish").slice(0, 40);

  if (username.length < 2 || username.length > 32) {
    return c.json({ error: "Username must be 2–32 characters" }, 400);
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return c.json(
      { error: "Username: letters, numbers, _ and - only" },
      400
    );
  }
  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
  }

  const invite = process.env.INVITE_CODE?.trim();
  if (invite && body.inviteCode?.trim() !== invite) {
    return c.json({ error: "Invalid invite code" }, 403);
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (existing) {
    return c.json({ error: "Username already taken" }, 409);
  }

  const id = nanoid();
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    id,
    username,
    passwordHash,
    pointsTotal: 0,
    promptLang,
    answerLang,
    createdAt: now,
  });

  const deck = await createDeckForUser({
    userId: id,
    promptLang,
    answerLang,
  });
  await setActiveDeck(id, deck.id);

  const sessionId = await createSession(id);
  setSessionCookie(c, sessionId);
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  return c.json({ user: publicUser(user!) }, 201);
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  const user = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  const sessionId = await createSession(user.id);
  setSessionCookie(c, sessionId);
  return c.json({ user: publicUser(user) });
});

authRoutes.post("/logout", requireAuth, async (c) => {
  const cookie = c.req.header("cookie") || "";
  const match = cookie.match(/fsv_session=([^;]+)/);
  if (match?.[1]) {
    await db.delete(sessions).where(eq(sessions.id, match[1]));
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  const { user } = await ensureActiveDeck(c.get("user"));
  return c.json({ user: publicUser(user) });
});

authRoutes.patch("/settings", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    promptLang?: string;
    answerLang?: string;
    elevenlabsApiKey?: string | null;
    clearElevenlabsKey?: boolean;
    promptVoiceId?: string | null;
    promptVoiceName?: string | null;
    answerVoiceId?: string | null;
    answerVoiceName?: string | null;
  }>();

  const { deck: activeDeck } = await ensureActiveDeck(user);

  const patch: Partial<typeof users.$inferInsert> = {};

  if (body.promptLang !== undefined || body.answerLang !== undefined) {
    const promptLang = (body.promptLang?.trim() || user.promptLang).slice(
      0,
      40
    );
    const answerLang = (body.answerLang?.trim() || user.answerLang).slice(
      0,
      40
    );
    if (!promptLang || !answerLang) {
      return c.json({ error: "Both language names are required" }, 400);
    }
    patch.promptLang = promptLang;
    patch.answerLang = answerLang;
    // Language pair belongs to the active deck
    await db
      .update(decks)
      .set({
        promptLang,
        answerLang,
        name: `${answerLang} ← ${promptLang}`,
      })
      .where(eq(decks.id, activeDeck.id));
  }

  if (body.clearElevenlabsKey) {
    patch.elevenlabsKeyEnc = null;
    patch.elevenlabsKeyHint = null;
    patch.promptVoiceId = null;
    patch.promptVoiceName = null;
    patch.answerVoiceId = null;
    patch.answerVoiceName = null;
  } else if (
    typeof body.elevenlabsApiKey === "string" &&
    body.elevenlabsApiKey.trim()
  ) {
    const apiKey = body.elevenlabsApiKey.trim();
    const check = await validateApiKey(apiKey);
    if (!check.ok) {
      return c.json(
        { error: check.error || "Invalid ElevenLabs API key" },
        400
      );
    }
    patch.elevenlabsKeyEnc = encryptSecret(apiKey, user.id);
    patch.elevenlabsKeyHint = keyHint(apiKey);
  }

  if (body.promptVoiceId !== undefined) {
    const voiceId = body.promptVoiceId?.trim() || null;
    const voiceName = body.promptVoiceName?.trim() || null;
    patch.promptVoiceId = voiceId;
    patch.promptVoiceName = voiceId ? voiceName : null;
  }

  if (body.answerVoiceId !== undefined) {
    const voiceId = body.answerVoiceId?.trim() || null;
    const voiceName = body.answerVoiceName?.trim() || null;
    patch.answerVoiceId = voiceId;
    patch.answerVoiceName = voiceId ? voiceName : null;
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ user: publicUser(user) });
  }

  await db.update(users).set(patch).where(eq(users.id, user.id));
  const updated = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  return c.json({ user: publicUser(updated!) });
});

authRoutes.get("/elevenlabs/voices", requireAuth, async (c) => {
  const user = c.get("user");
  const side = c.req.query("side");
  if (side !== "prompt" && side !== "answer") {
    return c.json({ error: "side must be prompt|answer" }, 400);
  }
  if (!user.elevenlabsKeyEnc) {
    return c.json({ error: "Add an ElevenLabs API key first" }, 400);
  }
  let apiKey: string;
  try {
    apiKey = decryptSecret(user.elevenlabsKeyEnc, user.id);
  } catch {
    return c.json({ error: "Could not decrypt stored API key" }, 500);
  }
  const langLabel = side === "prompt" ? user.promptLang : user.answerLang;
  const code = langCodeForLabel(langLabel);
  const result = await listVoicesForLanguage(apiKey, code);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({
    voices: result.voices,
    educationalOnly: result.educationalOnly,
    language: langLabel,
    languageCode: code,
  });
});
