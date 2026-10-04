import fs from "node:fs";
import path from "node:path";
import { getSqlite, resolvePath } from "../db/index.js";

const KEEP = 14;

/**
 * Snapshot the live DB (including WAL) before migrations / risky ops.
 * Keeps the newest KEEP files under data/backups/.
 */
export function backupDatabase(reason = "startup"): string | null {
  const dbPath = resolvePath(process.env.DATABASE_PATH || "./data/vocab.db");
  const sqlite = getSqlite();
  const backupDir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `vocab-${stamp}-${reason}.db`);

  try {
    // Online backup includes committed WAL frames — safer than copyFile on the main file
    sqlite.backup(dest);
  } catch {
    if (!fs.existsSync(dbPath)) return null;
    fs.copyFileSync(dbPath, dest);
  }

  const prior = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("vocab-") && f.endsWith(".db"))
    .map((f) => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  for (const old of prior.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(backupDir, old.f));
    } catch {
      /* ignore */
    }
  }

  return dest;
}
