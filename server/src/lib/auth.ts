import { and, eq, gt } from "drizzle-orm";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { sessions, users, type User } from "../db/schema.js";

const SESSION_COOKIE = "fsv_session";
const SESSION_DAYS = 30;

export type AuthVars = { user: User };

export async function createSession(userId: string): Promise<string> {
  const id = nanoid(32);
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt,
    createdAt: now,
  });
  return id;
}

export function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: process.env.COOKIE_SECURE === "true",
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function requireAuth(c: Context, next: Next) {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const now = Date.now();
  const row = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .get();

  if (!row) {
    clearSessionCookie(c);
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", row.user);
  await next();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    pointsTotal: user.pointsTotal,
    promptLang: user.promptLang,
    answerLang: user.answerLang,
    elevenlabsKeyHint: user.elevenlabsKeyHint ?? null,
    promptVoiceId: user.promptVoiceId ?? null,
    promptVoiceName: user.promptVoiceName ?? null,
    answerVoiceId: user.answerVoiceId ?? null,
    answerVoiceName: user.answerVoiceName ?? null,
    createdAt: user.createdAt,
  };
}
