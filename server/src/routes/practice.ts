import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { attempts, cards, pointEvents, users } from "../db/schema.js";
import { requireAuth, publicUser, type AuthVars } from "../lib/auth.js";
import { exactMatch, pickNextCard } from "../lib/mastery.js";
import { gradeWithGemma } from "../lib/lmstudio.js";
import { transcribeWithScriberr } from "../lib/scriberr.js";
import { getProgress } from "./cards.js";

export const practiceRoutes = new Hono<{ Variables: AuthVars }>();

practiceRoutes.use("*", requireAuth);

const LEARNED_STREAK = 3;

export type PracticeDirection = "forward" | "reverse";

function orientCard(
  card: typeof cards.$inferSelect,
  direction: PracticeDirection,
  promptLang: string,
  answerLang: string
) {
  if (direction === "reverse") {
    return {
      id: card.id,
      direction,
      prompt: card.answer,
      answer: card.prompt,
      hasPromptAudio: Boolean(card.answerAudioPath),
      hasAnswerAudio: Boolean(card.promptAudioPath),
      cueAudioSide: "answer" as const,
      replyAudioSide: "prompt" as const,
      cueLang: answerLang,
      replyLang: promptLang,
      status: card.status,
      streak: card.streak,
    };
  }
  return {
    id: card.id,
    direction,
    prompt: card.prompt,
    answer: card.answer,
    hasPromptAudio: Boolean(card.promptAudioPath),
    hasAnswerAudio: Boolean(card.answerAudioPath),
    cueAudioSide: "prompt" as const,
    replyAudioSide: "answer" as const,
    cueLang: promptLang,
    replyLang: answerLang,
    status: card.status,
    streak: card.streak,
  };
}

function parseDirection(raw: unknown): PracticeDirection {
  return raw === "reverse" ? "reverse" : "forward";
}

practiceRoutes.get("/next", async (c) => {
  const user = c.get("user");
  const lastId = c.req.query("last") || null;
  const all = await db
    .select()
    .from(cards)
    .where(eq(cards.userId, user.id))
    .all();

  if (all.length === 0) {
    return c.json({
      card: null,
      progress: await getProgress(user.id),
      langs: { promptLang: user.promptLang, answerLang: user.answerLang },
    });
  }

  const card = pickNextCard(all, lastId);
  if (!card) {
    return c.json({
      card: null,
      progress: await getProgress(user.id),
      langs: { promptLang: user.promptLang, answerLang: user.answerLang },
    });
  }

  const direction: PracticeDirection =
    Math.random() < 0.5 ? "forward" : "reverse";

  return c.json({
    card: orientCard(card, direction, user.promptLang, user.answerLang),
    progress: await getProgress(user.id),
    allLearned: all.every((x) => x.status === "learned"),
    langs: { promptLang: user.promptLang, answerLang: user.answerLang },
  });
});

async function awardPoints(
  userId: string,
  delta: number,
  reason: string
): Promise<number> {
  const now = Date.now();
  await db.insert(pointEvents).values({
    id: nanoid(),
    userId,
    delta,
    reason,
    createdAt: now,
  });
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  const next = (user?.pointsTotal ?? 0) + delta;
  await db
    .update(users)
    .set({ pointsTotal: next })
    .where(eq(users.id, userId));
  return next;
}

async function applyAnswer(opts: {
  userId: string;
  card: typeof cards.$inferSelect;
  answer: string;
  source: "type" | "speak";
  direction: PracticeDirection;
  promptLang: string;
  answerLang: string;
  pointsTotal: number;
}) {
  const { userId, card, answer, source, direction, promptLang, answerLang } =
    opts;
  const expected =
    direction === "reverse" ? card.prompt : card.answer;
  const cueText =
    direction === "reverse" ? card.answer : card.prompt;
  const cueLang = direction === "reverse" ? answerLang : promptLang;
  const replyLang = direction === "reverse" ? promptLang : answerLang;

  let correct = exactMatch(expected, answer);
  let reason = correct ? "Exact match" : "";
  let method: "exact" | "gemma" | "fallback" = "exact";

  if (!correct) {
    const graded = await gradeWithGemma(
      expected,
      answer,
      cueText,
      cueLang,
      replyLang
    );
    correct = graded.correct;
    reason = graded.reason;
    method = graded.method;
  }

  // Fuzzy grader down — don't mark wrong or advance streak
  if (!correct && method === "fallback") {
    const userRow = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return {
      correct: false,
      inconclusive: true as const,
      reason,
      method,
      expected,
      becameLearned: false,
      streak: card.streak,
      status: card.status,
      pointsAwarded: 0,
      user: publicUser(userRow!),
      progress: await getProgress(userId),
    };
  }

  const now = Date.now();
  await db.insert(attempts).values({
    id: nanoid(),
    userId,
    cardId: card.id,
    correct,
    source,
    answerText: answer,
    createdAt: now,
  });

  let newStatus = card.status;
  let newStreak = card.streak;
  let becameLearned = false;
  let pointsAwarded = 0;

  if (correct) {
    newStreak = card.streak + 1;
    if (newStreak >= LEARNED_STREAK && card.status !== "learned") {
      newStatus = "learned";
      becameLearned = true;
    } else if (card.status === "new") {
      newStatus = "practice";
    }
    await awardPoints(userId, 1, "correct_answer");
    pointsAwarded += 1;
    if (becameLearned) {
      await awardPoints(userId, 3, "card_learned");
      pointsAwarded += 3;
    }
  } else {
    newStreak = 0;
    newStatus = "practice";
  }

  await db
    .update(cards)
    .set({
      streak: newStreak,
      status: newStatus,
      seen: card.seen + 1,
      updatedAt: now,
    })
    .where(eq(cards.id, card.id));

  const progress = await getProgress(userId);
  if (becameLearned && progress.unlearned === 0 && progress.total > 0) {
    await awardPoints(userId, 5, "deck_cleared");
    pointsAwarded += 5;
  } else if (
    becameLearned &&
    progress.unlearned > 0 &&
    progress.unlearned <= 5
  ) {
    await awardPoints(userId, 2, "last_five_zone");
    pointsAwarded += 2;
  }

  const refreshed = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return {
    correct,
    inconclusive: false as const,
    reason: reason || (correct ? "Correct" : `Expected: ${expected}`),
    method,
    expected,
    becameLearned,
    streak: newStreak,
    status: newStatus,
    pointsAwarded,
    user: publicUser(refreshed!),
    progress: await getProgress(userId),
  };
}

practiceRoutes.post("/answer", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    cardId?: string;
    answer?: string;
    source?: "type" | "speak";
    direction?: PracticeDirection;
  }>();

  const cardId = body.cardId ?? "";
  const answer = (body.answer ?? "").trim();
  const source = body.source === "speak" ? "speak" : "type";
  const direction = parseDirection(body.direction);

  if (!cardId || !answer) {
    return c.json({ error: "cardId and answer required" }, 400);
  }

  const card = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, user.id)))
    .get();
  if (!card) return c.json({ error: "Card not found" }, 404);

  const result = await applyAnswer({
    userId: user.id,
    card,
    answer,
    source,
    direction,
    promptLang: user.promptLang,
    answerLang: user.answerLang,
    pointsTotal: user.pointsTotal,
  });
  return c.json(result);
});

practiceRoutes.post("/speak", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const cardId = String(form["cardId"] || "");
  const file = form["audio"];
  const direction = parseDirection(form["direction"]);

  if (!cardId || !file || !(file instanceof File)) {
    return c.json({ error: "cardId and audio required" }, 400);
  }

  const card = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, user.id)))
    .get();
  if (!card) return c.json({ error: "Card not found" }, 404);

  const speakLang =
    direction === "reverse" ? user.promptLang : user.answerLang;

  const transcribed = await transcribeWithScriberr(
    file,
    file.name || "answer.webm",
    { language: speakLang }
  );
  if (!transcribed.ok) {
    return c.json(
      {
        error: transcribed.error,
        timedOut: Boolean(transcribed.timedOut),
        elapsedMs: transcribed.elapsedMs,
      },
      502
    );
  }

  const result = await applyAnswer({
    userId: user.id,
    card,
    answer: transcribed.text.trim(),
    source: "speak",
    direction,
    promptLang: user.promptLang,
    answerLang: user.answerLang,
    pointsTotal: user.pointsTotal,
  });
  return c.json({
    transcript: transcribed.text,
    elapsedMs: transcribed.elapsedMs,
    ...result,
  });
});
