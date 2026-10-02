export type TranscribeResult =
  | { ok: true; text: string; elapsedMs: number }
  | { ok: false; error: string; timedOut?: boolean; elapsedMs: number };

export type TranscribeOptions = {
  /** ISO 639-1 or language name (e.g. "es" / "Spanish") — speeds Whisper up */
  language?: string;
  onProgress?: (info: { elapsedMs: number; phase: string }) => void;
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Map UI language labels to Whisper ISO codes. */
export function toWhisperLang(label: string | undefined | null): string | null {
  if (!label) return null;
  const n = label.trim().toLowerCase();
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(n)) return n.slice(0, 2);
  const map: Record<string, string> = {
    spanish: "es",
    español: "es",
    espanol: "es",
    english: "en",
    german: "de",
    deutsch: "de",
    french: "fr",
    français: "fr",
    francais: "fr",
    italian: "it",
    portuguese: "pt",
    portuguese_br: "pt",
    dutch: "nl",
    polish: "pl",
    swedish: "sv",
    norwegian: "no",
    danish: "da",
    finnish: "fi",
    russian: "ru",
    japanese: "ja",
    chinese: "zh",
    mandarin: "zh",
    korean: "ko",
    arabic: "ar",
    hindi: "hi",
    turkish: "tr",
    greek: "el",
    hebrew: "he",
    czech: "cs",
    hungarian: "hu",
    romanian: "ro",
    ukrainian: "uk",
    vietnamese: "vi",
    thai: "th",
    indonesian: "id",
    catalan: "ca",
  };
  return map[n] ?? null;
}

/**
 * Scriberr/WhisperX sometimes returns the whole result JSON as the "text"
 * field. Pull out the spoken words only.
 */
function extractPlainText(value: string): string {
  let current = value.trim();
  for (let i = 0; i < 3; i++) {
    if (!current.startsWith("{") && !current.startsWith("[")) break;
    try {
      const parsed = JSON.parse(current) as unknown;
      if (typeof parsed === "string") {
        current = parsed.trim();
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) break;
      const obj = parsed as Record<string, unknown>;
      let foundInner: string | null = null;
      for (const key of ["text", "transcript", "transcription"]) {
        const inner = obj[key];
        if (typeof inner === "string" && inner.trim()) {
          foundInner = inner.trim();
          break;
        }
      }
      if (foundInner) {
        current = foundInner;
        continue;
      }
      if (Array.isArray(obj.segments)) {
        const joined = obj.segments
          .map((seg) => {
            if (!seg || typeof seg !== "object") return "";
            const t = (seg as Record<string, unknown>).text;
            return typeof t === "string" ? t : "";
          })
          .join("")
          .trim();
        if (joined) return joined;
      }
      break;
    } catch {
      break;
    }
  }
  if (
    current.startsWith("{") &&
    /"word_segments"|"segments"|"model_used"/.test(current)
  ) {
    try {
      const obj = JSON.parse(current) as Record<string, unknown>;
      if (typeof obj.text === "string") return obj.text.trim();
    } catch {
      /* ignore */
    }
  }
  return current;
}

function pickTranscript(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const key of ["transcript", "text", "transcription"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) {
      const plain = extractPlainText(v);
      if (plain && !plain.startsWith("{")) return plain;
      if (plain && plain !== v.trim()) return plain;
    }
  }
  if (p.result && typeof p.result === "object") {
    const nested = pickTranscript(p.result);
    if (nested) return nested;
  }
  if (p.data && typeof p.data === "object") {
    const nested = pickTranscript(p.data);
    if (nested) return nested;
  }
  // WhisperX-shaped payload at top level
  if (typeof p.text === "string" && p.segments) {
    const plain = extractPlainText(JSON.stringify(p));
    if (plain) return plain;
  }
  return null;
}

function jobDone(payload: Record<string, unknown>): boolean {
  const s = String(payload.status ?? payload.state ?? "").toLowerCase();
  return ["completed", "complete", "done", "success", "succeeded"].includes(s);
}

function jobFailed(payload: Record<string, unknown>): boolean {
  const s = String(payload.status ?? payload.state ?? "").toLowerCase();
  return ["failed", "error", "cancelled", "canceled"].includes(s);
}

/**
 * WhisperX "small" on CPU can take 2–4+ minutes for a short clip.
 * We poll long enough for that, and ask for a lighter model when possible.
 */
export async function transcribeWithScriberr(
  audio: Blob,
  filename = "answer.webm",
  options: TranscribeOptions = {}
): Promise<TranscribeResult> {
  const base = process.env.SCRIBERR_URL || "http://127.0.0.1:8080";
  const apiKey = process.env.SCRIBERR_API_KEY || "";
  const started = Date.now();
  const maxWaitMs = Number(process.env.SCRIBERR_TIMEOUT_MS || 240_000);
  const pollMs = Number(process.env.SCRIBERR_POLL_MS || 1_000);
  const lang = toWhisperLang(options.language);

  if (!apiKey) {
    return {
      ok: false,
      error:
        "SCRIBERR_API_KEY is not set. Create an API key in the Scriberr UI and add it to .env",
      elapsedMs: 0,
    };
  }

  const form = new FormData();
  form.append("audio", audio, filename);
  // Hints for lighter/faster local runs (ignored if Scriberr doesn't accept them)
  form.append("model", process.env.SCRIBERR_MODEL || "tiny");
  form.append("model_family", process.env.SCRIBERR_MODEL_FAMILY || "whisper");
  form.append("device", "cpu");
  form.append("best_of", "1");
  form.append("beam_size", "1");
  if (lang) {
    form.append("language", lang);
    form.append("lang", lang);
  }

  try {
    options.onProgress?.({ elapsedMs: 0, phase: "Submitting audio…" });
    const submit = await fetch(`${base}/api/v1/transcription/quick`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!submit.ok) {
      const body = await submit.text();
      return {
        ok: false,
        error: `Scriberr submit failed (${submit.status}): ${body.slice(0, 200)}`,
        elapsedMs: Date.now() - started,
      };
    }

    const submitted = (await submit.json()) as Record<string, unknown>;
    const immediate = pickTranscript(submitted);
    if (immediate) {
      return { ok: true, text: immediate, elapsedMs: Date.now() - started };
    }

    const jobId = String(submitted.id || submitted.job_id || "");
    if (!jobId) {
      return {
        ok: false,
        error: "Scriberr did not return a job id or transcript",
        elapsedMs: Date.now() - started,
      };
    }

    while (Date.now() - started < maxWaitMs) {
      await sleep(pollMs);
      const elapsedMs = Date.now() - started;
      options.onProgress?.({
        elapsedMs,
        phase: `Transcribing… ${Math.round(elapsedMs / 1000)}s`,
      });

      const statusRes = await fetch(
        `${base}/api/v1/transcription/quick/${jobId}`,
        {
          headers: { "X-API-Key": apiKey },
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!statusRes.ok) {
        const body = await statusRes.text();
        return {
          ok: false,
          error: `Scriberr status failed (${statusRes.status}): ${body.slice(0, 200)}`,
          elapsedMs,
        };
      }

      const status = (await statusRes.json()) as Record<string, unknown>;
      const text = pickTranscript(status);
      if (text) {
        return { ok: true, text, elapsedMs: Date.now() - started };
      }
      if (jobFailed(status)) {
        return {
          ok: false,
          error: String(status.error || "Transcription failed"),
          elapsedMs,
        };
      }
      if (jobDone(status) && !text) {
        return {
          ok: false,
          error: "Transcription completed with empty text",
          elapsedMs,
        };
      }
    }

    return {
      ok: false,
      error:
        "Transcription timed out. WhisperX on CPU can take several minutes — try again, or type your answer.",
      timedOut: true,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scriberr unavailable";
    return {
      ok: false,
      error: `Cannot reach Scriberr at ${base}: ${msg}. Is \`scriberr\` running?`,
      elapsedMs: Date.now() - started,
    };
  }
}
