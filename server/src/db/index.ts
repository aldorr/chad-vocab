import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../");

export function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

const dbPath = resolvePath(process.env.DATABASE_PATH || "./data/vocab.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      points_total INTEGER NOT NULL DEFAULT 0,
      prompt_lang TEXT NOT NULL DEFAULT 'German',
      answer_lang TEXT NOT NULL DEFAULT 'Spanish',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prompt_lang TEXT NOT NULL,
      answer_lang TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answer TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer_audio_path TEXT,
      prompt_audio_path TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      streak INTEGER NOT NULL DEFAULT 0,
      seen INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      correct INTEGER NOT NULL,
      source TEXT NOT NULL,
      answer_text TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS point_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
  `);

  // Lightweight upgrades for existing DBs from early scaffolds
  const cols = sqlite
    .prepare(`PRAGMA table_info(users)`)
    .all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("prompt_lang")) {
    sqlite.exec(
      `ALTER TABLE users ADD COLUMN prompt_lang TEXT NOT NULL DEFAULT 'German'`
    );
  }
  if (!names.has("answer_lang")) {
    sqlite.exec(
      `ALTER TABLE users ADD COLUMN answer_lang TEXT NOT NULL DEFAULT 'Spanish'`
    );
  }
  if (!names.has("active_deck_id")) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN active_deck_id TEXT`);
  }
  if (!names.has("elevenlabs_key_enc")) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN elevenlabs_key_enc TEXT`);
  }
  if (!names.has("elevenlabs_key_hint")) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN elevenlabs_key_hint TEXT`);
  }
  if (!names.has("prompt_voice_id")) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN prompt_voice_id TEXT`);
  }
  if (!names.has("prompt_voice_name")) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN prompt_voice_name TEXT`);
  }
  if (!names.has("answer_voice_id")) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN answer_voice_id TEXT`);
  }
  if (!names.has("answer_voice_name")) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN answer_voice_name TEXT`);
  }

  const cardCols = sqlite
    .prepare(`PRAGMA table_info(cards)`)
    .all() as { name: string }[];
  const cardNames = new Set(cardCols.map((c) => c.name));
  if (cardNames.has("es") && !cardNames.has("answer")) {
    sqlite.exec(`ALTER TABLE cards RENAME COLUMN es TO answer`);
  }
  if (cardNames.has("de") && !cardNames.has("prompt")) {
    sqlite.exec(`ALTER TABLE cards RENAME COLUMN de TO prompt`);
  }
  if (!cardNames.has("answer_audio_path")) {
    sqlite.exec(`ALTER TABLE cards ADD COLUMN answer_audio_path TEXT`);
  }
  if (!cardNames.has("prompt_audio_path")) {
    sqlite.exec(`ALTER TABLE cards ADD COLUMN prompt_audio_path TEXT`);
  }
  if (!cardNames.has("deck_id")) {
    sqlite.exec(`ALTER TABLE cards ADD COLUMN deck_id TEXT`);
  }
  // Move legacy single recording onto the cue side
  if (cardNames.has("audio_path")) {
    sqlite.exec(`
      UPDATE cards
      SET prompt_audio_path = audio_path
      WHERE audio_path IS NOT NULL
        AND (prompt_audio_path IS NULL OR prompt_audio_path = '')
    `);
  }

  // Backfill: one deck per user; attach orphan cards; set active deck
  const userRows = sqlite
    .prepare(
      `SELECT id, prompt_lang, answer_lang, active_deck_id FROM users`
    )
    .all() as {
    id: string;
    prompt_lang: string;
    answer_lang: string;
    active_deck_id: string | null;
  }[];

  for (const u of userRows) {
    let deckId = u.active_deck_id;
    const existingDeck = deckId
      ? (sqlite
          .prepare(`SELECT id FROM decks WHERE id = ? AND user_id = ?`)
          .get(deckId, u.id) as { id: string } | undefined)
      : undefined;

    if (!existingDeck) {
      const first = sqlite
        .prepare(
          `SELECT id FROM decks WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`
        )
        .get(u.id) as { id: string } | undefined;
      if (first) {
        deckId = first.id;
      } else {
        deckId = `deck_${u.id.slice(0, 12)}_${Date.now().toString(36)}`;
        const name = `${u.answer_lang} ← ${u.prompt_lang}`;
        sqlite
          .prepare(
            `INSERT INTO decks (id, user_id, name, prompt_lang, answer_lang, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            deckId,
            u.id,
            name,
            u.prompt_lang || "English",
            u.answer_lang || "Spanish",
            Date.now()
          );
      }
      sqlite
        .prepare(`UPDATE users SET active_deck_id = ? WHERE id = ?`)
        .run(deckId, u.id);
    }

    sqlite
      .prepare(
        `UPDATE cards SET deck_id = ? WHERE user_id = ? AND (deck_id IS NULL OR deck_id = '')`
      )
      .run(deckId, u.id);
  }

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id)`);
}
