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
  // Move legacy single recording onto the cue side
  if (cardNames.has("audio_path")) {
    sqlite.exec(`
      UPDATE cards
      SET prompt_audio_path = audio_path
      WHERE audio_path IS NOT NULL
        AND (prompt_audio_path IS NULL OR prompt_audio_path = '')
    `);
  }
}
