import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
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
  return c.json({ user: publicUser(c.get("user")) });
});

authRoutes.patch("/settings", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    promptLang?: string;
    answerLang?: string;
  }>();
  const promptLang = (body.promptLang?.trim() || user.promptLang).slice(0, 40);
  const answerLang = (body.answerLang?.trim() || user.answerLang).slice(0, 40);
  if (!promptLang || !answerLang) {
    return c.json({ error: "Both language names are required" }, 400);
  }
  await db
    .update(users)
    .set({ promptLang, answerLang })
    .where(eq(users.id, user.id));
  const updated = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  return c.json({ user: publicUser(updated!) });
});
