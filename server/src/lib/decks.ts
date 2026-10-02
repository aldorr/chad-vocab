import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { cards, decks, users, type Deck, type User } from "../db/schema.js";

export function deckDisplayName(answerLang: string, promptLang: string): string {
  return `${answerLang} ← ${promptLang}`;
}

export function publicDeck(deck: Deck) {
  return {
    id: deck.id,
    name: deck.name,
    promptLang: deck.promptLang,
    answerLang: deck.answerLang,
    createdAt: deck.createdAt,
  };
}

export async function createDeckForUser(opts: {
  userId: string;
  promptLang: string;
  answerLang: string;
  name?: string;
}): Promise<Deck> {
  const now = Date.now();
  const id = nanoid();
  const promptLang = opts.promptLang.trim().slice(0, 40);
  const answerLang = opts.answerLang.trim().slice(0, 40);
  const name =
    opts.name?.trim().slice(0, 80) ||
    deckDisplayName(answerLang, promptLang);
  await db.insert(decks).values({
    id,
    userId: opts.userId,
    name,
    promptLang,
    answerLang,
    createdAt: now,
  });
  const deck = await db.select().from(decks).where(eq(decks.id, id)).get();
  return deck!;
}

/** Ensure the user has at least one deck and a valid activeDeckId. Syncs lang mirrors. */
export async function ensureActiveDeck(user: User): Promise<{
  user: User;
  deck: Deck;
}> {
  let deckList = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, user.id))
    .all();

  if (deckList.length === 0) {
    const deck = await createDeckForUser({
      userId: user.id,
      promptLang: user.promptLang || "English",
      answerLang: user.answerLang || "Spanish",
    });
    // Attach any orphan cards (pre-migration) to this deck
    await db
      .update(cards)
      .set({ deckId: deck.id })
      .where(and(eq(cards.userId, user.id)));
    await db
      .update(users)
      .set({
        activeDeckId: deck.id,
        promptLang: deck.promptLang,
        answerLang: deck.answerLang,
      })
      .where(eq(users.id, user.id));
    const refreshed = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .get();
    return { user: refreshed!, deck };
  }

  let deck =
    (user.activeDeckId
      ? deckList.find((d) => d.id === user.activeDeckId)
      : undefined) ?? deckList[0]!;

  if (user.activeDeckId !== deck.id) {
    await db
      .update(users)
      .set({
        activeDeckId: deck.id,
        promptLang: deck.promptLang,
        answerLang: deck.answerLang,
      })
      .where(eq(users.id, user.id));
  } else if (
    user.promptLang !== deck.promptLang ||
    user.answerLang !== deck.answerLang
  ) {
    await db
      .update(users)
      .set({
        promptLang: deck.promptLang,
        answerLang: deck.answerLang,
      })
      .where(eq(users.id, user.id));
  }

  const refreshed = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  return { user: refreshed!, deck };
}

export async function setActiveDeck(
  userId: string,
  deckId: string
): Promise<{ user: User; deck: Deck } | null> {
  const deck = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .get();
  if (!deck) return null;
  await db
    .update(users)
    .set({
      activeDeckId: deck.id,
      promptLang: deck.promptLang,
      answerLang: deck.answerLang,
    })
    .where(eq(users.id, userId));
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  return { user: user!, deck };
}
