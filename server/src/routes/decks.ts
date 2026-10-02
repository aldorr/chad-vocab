import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { cards, decks, users } from "../db/schema.js";
import { requireAuth, publicUser, type AuthVars } from "../lib/auth.js";
import {
  createDeckForUser,
  deckDisplayName,
  ensureActiveDeck,
  publicDeck,
  setActiveDeck,
} from "../lib/decks.js";

export const deckRoutes = new Hono<{ Variables: AuthVars }>();

deckRoutes.use("*", requireAuth);

deckRoutes.get("/", async (c) => {
  const user = c.get("user");
  const { user: synced, deck: active } = await ensureActiveDeck(user);
  const list = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, synced.id))
    .all();
  return c.json({
    decks: list.map(publicDeck),
    activeDeckId: active.id,
    user: publicUser(synced),
  });
});

deckRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    promptLang?: string;
    answerLang?: string;
    name?: string;
    activate?: boolean;
  }>();
  const promptLang = (body.promptLang?.trim() || "").slice(0, 40);
  const answerLang = (body.answerLang?.trim() || "").slice(0, 40);
  if (!promptLang || !answerLang) {
    return c.json({ error: "Cue and answer languages are required" }, 400);
  }

  const deck = await createDeckForUser({
    userId: user.id,
    promptLang,
    answerLang,
    name: body.name,
  });

  const activate = body.activate !== false;
  if (activate) {
    const switched = await setActiveDeck(user.id, deck.id);
    return c.json(
      {
        deck: publicDeck(deck),
        user: publicUser(switched!.user),
      },
      201
    );
  }

  return c.json({ deck: publicDeck(deck), user: publicUser(user) }, 201);
});

deckRoutes.post("/:id/activate", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const switched = await setActiveDeck(user.id, id);
  if (!switched) return c.json({ error: "Deck not found" }, 404);
  return c.json({
    deck: publicDeck(switched.deck),
    user: publicUser(switched.user),
  });
});

deckRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    promptLang?: string;
    answerLang?: string;
  }>();

  const deck = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, id), eq(decks.userId, user.id)))
    .get();
  if (!deck) return c.json({ error: "Deck not found" }, 404);

  const promptLang = (
    body.promptLang?.trim() ||
    deck.promptLang
  ).slice(0, 40);
  const answerLang = (
    body.answerLang?.trim() ||
    deck.answerLang
  ).slice(0, 40);
  if (!promptLang || !answerLang) {
    return c.json({ error: "Both language names are required" }, 400);
  }

  const name =
    body.name?.trim().slice(0, 80) ||
    (body.promptLang || body.answerLang
      ? deckDisplayName(answerLang, promptLang)
      : deck.name);

  await db
    .update(decks)
    .set({ name, promptLang, answerLang })
    .where(eq(decks.id, id));

  // Keep user mirror in sync when editing the active deck
  if (user.activeDeckId === id) {
    await db
      .update(users)
      .set({ promptLang, answerLang })
      .where(eq(users.id, user.id));
  }

  const updated = await db.select().from(decks).where(eq(decks.id, id)).get();
  const refreshed = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  return c.json({
    deck: publicDeck(updated!),
    user: publicUser(refreshed!),
  });
});

deckRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const list = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, user.id))
    .all();
  if (list.length <= 1) {
    return c.json(
      { error: "Keep at least one deck. Create another before deleting this one." },
      400
    );
  }

  const deck = list.find((d) => d.id === id);
  if (!deck) return c.json({ error: "Deck not found" }, 404);

  // Cards cascade via FK once deck_id is set; also delete explicitly for safety
  await db.delete(cards).where(and(eq(cards.deckId, id), eq(cards.userId, user.id)));
  await db.delete(decks).where(and(eq(decks.id, id), eq(decks.userId, user.id)));

  let nextUser = user;
  if (user.activeDeckId === id) {
    const remaining = list.filter((d) => d.id !== id)[0]!;
    const switched = await setActiveDeck(user.id, remaining.id);
    nextUser = switched!.user;
  }

  return c.json({ ok: true, user: publicUser(nextUser) });
});
