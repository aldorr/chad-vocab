import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, resolvePath } from "../db/index.js";
import { cards, type Card, type User } from "../db/schema.js";
import {
  langCodeForLabel,
  synthesizeSpeech,
} from "./elevenlabs.js";
import { decryptSecret } from "./secret.js";

export type AudioSide = "answer" | "prompt";

function audioDir(): string {
  return resolvePath(process.env.AUDIO_DIR || "./data/audio");
}

export function contentTypeForAudioPath(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  if (ext === ".mp3" || ext === ".mpeg") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  return "audio/webm";
}

export function userCanGenerateSpeech(user: User): boolean {
  return Boolean(
    user.elevenlabsKeyEnc && user.promptVoiceId && user.answerVoiceId
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

type SideJob = {
  card: Card;
  side: AudioSide;
  text: string;
  voiceId: string;
  languageCode: string | null;
};

export type GenerateResult = {
  generated: number;
  skipped: number;
  failed: number;
  errors: string[];
  cards: Array<{
    id: string;
    hasAnswerAudio: boolean;
    hasPromptAudio: boolean;
  }>;
};

export async function generateMissingAudio(
  user: User,
  options: {
    cardIds?: string[];
    regenerate?: boolean;
  } = {}
): Promise<GenerateResult | { error: string }> {
  if (!user.elevenlabsKeyEnc) {
    return { error: "Add an ElevenLabs API key on Progress first" };
  }
  if (!user.promptVoiceId || !user.answerVoiceId) {
    return {
      error: "Pick cue and answer voices on Progress before generating audio",
    };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(user.elevenlabsKeyEnc, user.id);
  } catch {
    return { error: "Could not decrypt stored API key" };
  }

  let list: Card[];
  if (options.cardIds?.length) {
    list = await db
      .select()
      .from(cards)
      .where(
        and(eq(cards.userId, user.id), inArray(cards.id, options.cardIds))
      )
      .all();
  } else if (user.activeDeckId) {
    list = await db
      .select()
      .from(cards)
      .where(
        and(eq(cards.userId, user.id), eq(cards.deckId, user.activeDeckId))
      )
      .all();
  } else {
    list = await db
      .select()
      .from(cards)
      .where(eq(cards.userId, user.id))
      .all();
  }

  const promptCode = langCodeForLabel(user.promptLang);
  const answerCode = langCodeForLabel(user.answerLang);
  const jobs: SideJob[] = [];
  let skipped = 0;

  for (const card of list) {
    const needPrompt =
      options.regenerate || !card.promptAudioPath;
    const needAnswer =
      options.regenerate || !card.answerAudioPath;
    if (!needPrompt) skipped++;
    else {
      jobs.push({
        card,
        side: "prompt",
        text: card.prompt,
        voiceId: user.promptVoiceId,
        languageCode: promptCode,
      });
    }
    if (!needAnswer) skipped++;
    else {
      jobs.push({
        card,
        side: "answer",
        text: card.answer,
        voiceId: user.answerVoiceId,
        languageCode: answerCode,
      });
    }
  }

  const userDir = path.join(audioDir(), user.id);
  fs.mkdirSync(userDir, { recursive: true });

  let generated = 0;
  let failed = 0;
  const errors: string[] = [];
  const touched = new Set<string>();

  await mapPool(jobs, 2, async (job) => {
    const { card, side, text, voiceId, languageCode } = job;
    const result = await synthesizeSpeech(apiKey, voiceId, text, languageCode);
    if (!result.ok) {
      failed++;
      if (errors.length < 5) {
        errors.push(`${text}: ${result.error}`);
      }
      return;
    }

    const rel = path.join(user.id, `${card.id}-${side}.mp3`);
    const full = path.join(audioDir(), rel);
    const prev =
      side === "answer" ? card.answerAudioPath : card.promptAudioPath;
    if (prev && prev !== rel) {
      const old = path.join(audioDir(), prev);
      if (fs.existsSync(old)) {
        try {
          fs.unlinkSync(old);
        } catch {
          /* ignore */
        }
      }
    }
    fs.writeFileSync(full, result.audio);
    await db
      .update(cards)
      .set(
        side === "answer"
          ? { answerAudioPath: rel, updatedAt: Date.now() }
          : { promptAudioPath: rel, updatedAt: Date.now() }
      )
      .where(eq(cards.id, card.id));
    if (side === "answer") card.answerAudioPath = rel;
    else card.promptAudioPath = rel;
    generated++;
    touched.add(card.id);
  });

  if (touched.size > 0) {
    const refreshed = await db
      .select()
      .from(cards)
      .where(
        and(eq(cards.userId, user.id), inArray(cards.id, [...touched]))
      )
      .all();
    const byId = new Map(list.map((c) => [c.id, c]));
    for (const row of refreshed) byId.set(row.id, row);
    list = [...byId.values()];
  }

  return {
    generated,
    skipped,
    failed,
    errors,
    cards: list.map((c) => ({
      id: c.id,
      hasAnswerAudio: Boolean(c.answerAudioPath),
      hasPromptAudio: Boolean(c.promptAudioPath),
    })),
  };
}
