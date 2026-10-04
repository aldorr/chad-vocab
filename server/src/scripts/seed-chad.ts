/**
 * Seed the demo account for Chad (English cues → Polish answers).
 * Writes credentials to repo-root `.demo-credentials` (gitignored).
 *
 * Usage: npm run seed:chad
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, migrate } from "../db/index.js";
import { cards, decks, users } from "../db/schema.js";
import { hashPassword } from "../lib/auth.js";
import { createDeckForUser, setActiveDeck } from "../lib/decks.js";

function loadEnv() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../"
  );
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return root;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return root;
}

const STARTER: { prompt: string; answer: string }[] = [
  { prompt: "hello", answer: "cześć" },
  { prompt: "thank you", answer: "dziękuję" },
  { prompt: "please", answer: "proszę" },
  { prompt: "yes", answer: "tak" },
  { prompt: "no", answer: "nie" },
  { prompt: "good morning", answer: "dzień dobry" },
  { prompt: "good night", answer: "dobranoc" },
  { prompt: "water", answer: "woda" },
  { prompt: "bread", answer: "chleb" },
  { prompt: "friend", answer: "przyjaciel" },
  { prompt: "I don't understand", answer: "nie rozumiem" },
  { prompt: "how are you?", answer: "jak się masz?" },
];

async function main() {
  const root = loadEnv();
  migrate();

  const username = "chad";
  const password = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(password);
  const now = Date.now();

  let user = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();

  if (user) {
    await db
      .update(users)
      .set({
        passwordHash,
        promptLang: "English",
        answerLang: "Polish",
      })
      .where(eq(users.id, user.id));
    user = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .get();
  } else {
    const id = nanoid();
    await db.insert(users).values({
      id,
      username,
      passwordHash,
      pointsTotal: 0,
      promptLang: "English",
      answerLang: "Polish",
      createdAt: now,
    });
    user = await db.select().from(users).where(eq(users.id, id)).get();
  }

  if (!user) throw new Error("Failed to create chad user");

  let deckList = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, user.id))
    .all();

  let deck = deckList.find(
    (d) => d.answerLang === "Polish" && d.promptLang === "English"
  );
  if (!deck) {
    deck = await createDeckForUser({
      userId: user.id,
      promptLang: "English",
      answerLang: "Polish",
      name: "Polish ← English",
    });
  }
  await setActiveDeck(user.id, deck.id);

  const existingCards = await db
    .select()
    .from(cards)
    .where(eq(cards.deckId, deck.id))
    .all();

  if (existingCards.length === 0) {
    for (const pair of STARTER) {
      await db.insert(cards).values({
        id: nanoid(),
        userId: user.id,
        deckId: deck.id,
        answer: pair.answer,
        prompt: pair.prompt,
        status: "new",
        streak: 0,
        seen: 0,
        updatedAt: now,
        createdAt: now,
      });
    }
  }

  const credPath = path.join(root, ".demo-credentials");
  const body = [
    "# Chad Vocab demo login — do not commit",
    `username=${username}`,
    `password=${password}`,
    "promptLang=English",
    "answerLang=Polish",
    "demo=https://vocab.aldorr.net/",
    "",
  ].join("\n");
  fs.writeFileSync(credPath, body, { mode: 0o600 });

  console.log("Seeded Chad Vocab demo account");
  console.log(`  username: ${username}`);
  console.log(`  password: ${password}`);
  console.log(`  deck: ${deck.name} (${STARTER.length} starter cards if empty)`);
  console.log(`  credentials file: ${credPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
