/**
 * Seed the demo account for Chad (English cues → Polish answers).
 * Writes credentials to repo-root `.demo-credentials` (gitignored).
 *
 * Usage: npm run seed:chad
 *
 * Re-running keeps the existing password (from .demo-credentials or DB)
 * and only fills the Polish←English deck when it is empty.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, migrate } from "../db/index.js";
import { decks, users } from "../db/schema.js";
import { hashPassword } from "../lib/auth.js";
import { createDeckForUser, setActiveDeck } from "../lib/decks.js";
import { seedSampleCardsIfEmpty } from "../lib/seedDeck.js";

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

function readStoredPassword(root: string): string | null {
  const credPath = path.join(root, ".demo-credentials");
  if (!fs.existsSync(credPath)) return null;
  for (const line of fs.readFileSync(credPath, "utf8").split("\n")) {
    if (line.startsWith("password=")) {
      const pw = line.slice("password=".length).trim();
      return pw || null;
    }
  }
  return null;
}

async function main() {
  const root = loadEnv();
  migrate();

  const username = "chad";
  const storedPassword = readStoredPassword(root);
  const password =
    process.env.CHAD_DEMO_PASSWORD?.trim() ||
    storedPassword ||
    crypto.randomBytes(9).toString("base64url");
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

  const deckList = await db
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

  const added = await seedSampleCardsIfEmpty({
    userId: user.id,
    deckId: deck.id,
    answerLang: "Polish",
    promptLang: "English",
  });

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
  console.log(
    `  deck: ${deck.name} (${added > 0 ? `added ${added} starter cards` : "starter cards already present"})`
  );
  console.log(`  credentials file: ${credPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
