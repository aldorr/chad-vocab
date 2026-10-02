import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  pointsTotal: integer("points_total").notNull().default(0),
  /**
   * Mirrored from the active deck for convenience / legacy.
   * Prefer reading langs from the active deck when possible.
   */
  promptLang: text("prompt_lang").notNull().default("German"),
  answerLang: text("answer_lang").notNull().default("Spanish"),
  activeDeckId: text("active_deck_id"),
  /** AES-256-GCM ciphertext of the user's ElevenLabs API key (never returned). */
  elevenlabsKeyEnc: text("elevenlabs_key_enc"),
  /** Last-4 hint shown in the UI, e.g. "…ab12". */
  elevenlabsKeyHint: text("elevenlabs_key_hint"),
  promptVoiceId: text("prompt_voice_id"),
  promptVoiceName: text("prompt_voice_name"),
  answerVoiceId: text("answer_voice_id"),
  answerVoiceName: text("answer_voice_name"),
  createdAt: integer("created_at").notNull(),
});

export const decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Language shown as the cue (e.g. German, English). */
  promptLang: text("prompt_lang").notNull(),
  /** Language the learner must produce (e.g. Spanish, French). */
  answerLang: text("answer_lang").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deckId: text("deck_id")
    .notNull()
    .references(() => decks.id, { onDelete: "cascade" }),
  /** Word/phrase in the language being learned. */
  answer: text("answer").notNull(),
  /** Cue shown/spoken in the known language. */
  prompt: text("prompt").notNull(),
  /** Recording of the learning-language word. */
  answerAudioPath: text("answer_audio_path"),
  /** Recording of the cue-language word. */
  promptAudioPath: text("prompt_audio_path"),
  status: text("status", { enum: ["new", "practice", "learned"] })
    .notNull()
    .default("new"),
  streak: integer("streak").notNull().default(0),
  seen: integer("seen").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  cardId: text("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  source: text("source", { enum: ["type", "speak"] }).notNull(),
  answerText: text("answer_text"),
  createdAt: integer("created_at").notNull(),
});

export const pointEvents = sqliteTable("point_events", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Deck = typeof decks.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type CardStatus = Card["status"];
