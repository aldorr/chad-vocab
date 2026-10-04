import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { cards } from "../db/schema.js";
import { getSamplePairs } from "./samplePairs.js";

/** Insert language-pair sample cards when a deck is empty. Returns how many were added. */
export async function seedSampleCardsIfEmpty(opts: {
  userId: string;
  deckId: string;
  answerLang: string;
  promptLang: string;
}): Promise<number> {
  const existing = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.deckId, opts.deckId))
    .all();
  if (existing.length > 0) return 0;

  const pairs = getSamplePairs(opts.answerLang, opts.promptLang);
  if (!pairs.length) return 0;

  const now = Date.now();
  for (const pair of pairs) {
    await db.insert(cards).values({
      id: nanoid(),
      userId: opts.userId,
      deckId: opts.deckId,
      answer: pair.answer,
      prompt: pair.prompt,
      status: "new",
      streak: 0,
      seen: 0,
      updatedAt: now,
      createdAt: now,
    });
  }
  return pairs.length;
}
