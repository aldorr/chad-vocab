import type { Card } from "../db/schema.js";

/** Pick the next card using mastery queue rules from the plan. */
export function pickNextCard(
  all: Card[],
  lastId?: string | null
): Card | null {
  if (all.length === 0) return null;

  const pool = lastId && all.length > 1 ? all.filter((c) => c.id !== lastId) : all;
  const unlearned = pool.filter((c) => c.status !== "learned");
  const learned = pool.filter((c) => c.status === "learned");
  const unlearnedAll = all.filter((c) => c.status !== "learned");

  // Endgame: ≤5 unlearned — alternate those with random learned
  if (unlearnedAll.length > 0 && unlearnedAll.length <= 5) {
    const preferUnlearned = Math.random() < 0.55 || learned.length === 0;
    if (preferUnlearned && unlearned.length > 0) {
      return weightedUnlearned(unlearned);
    }
    if (learned.length > 0) {
      return learned[Math.floor(Math.random() * learned.length)]!;
    }
    return weightedUnlearned(unlearnedAll);
  }

  // While many remain: ~10% learned review
  if (learned.length > 0 && Math.random() < 0.1) {
    return learned[Math.floor(Math.random() * learned.length)]!;
  }

  if (unlearned.length === 0) {
    return learned[Math.floor(Math.random() * learned.length)] ?? null;
  }

  return weightedUnlearned(unlearned);
}

function weightedUnlearned(cards: Card[]): Card {
  const practice = cards.filter((c) => c.status === "practice");
  const fresh = cards.filter((c) => c.status === "new");
  const roll = Math.random();
  if (practice.length && roll < 0.55) {
    return practice[Math.floor(Math.random() * practice.length)]!;
  }
  if (fresh.length && roll < 0.9) {
    return fresh[Math.floor(Math.random() * fresh.length)]!;
  }
  return cards[Math.floor(Math.random() * cards.length)]!;
}

export function normalizeAnswer(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[¿?¡!.,;:"""«»]/g, "")
    .replace(/\s+/g, " ");
}

/** Exact match after normalize; accents kept (Spanish). */
export function exactMatch(expected: string, given: string): boolean {
  return normalizeAnswer(expected) === normalizeAnswer(given);
}
