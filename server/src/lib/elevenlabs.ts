import { toWhisperLang } from "./scriberr.js";

const BASE = "https://api.elevenlabs.io";
const TTS_MODEL = "eleven_turbo_v2_5";
const STT_MODEL = "scribe_v2";

export type VoiceOption = {
  voiceId: string;
  name: string;
  language: string | null;
  accent: string | null;
  previewUrl: string | null;
  educational: boolean;
  /** ElevenLabs category: premade, generated, cloned, … */
  category: string | null;
};

export type ElevenLabsError = {
  ok: false;
  error: string;
  status?: number;
};

function headers(apiKey: string, json = false): HeadersInit {
  const h: Record<string, string> = { "xi-api-key": apiKey };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      detail?: { message?: string } | string;
      message?: string;
    };
    if (typeof body.detail === "string") return body.detail;
    if (body.detail && typeof body.detail === "object" && body.detail.message) {
      return body.detail.message;
    }
    if (body.message) return body.message;
  } catch {
    /* ignore */
  }
  return `ElevenLabs HTTP ${res.status}`;
}

export function langCodeForLabel(
  label: string | null | undefined
): string | null {
  return toWhisperLang(label);
}

function isEducationalUseCase(value: string | null | undefined): boolean {
  if (!value) return false;
  const n = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  return n === "educational" || n === "education" || n.includes("educational");
}

/** Free-plan API can use default/premade and generated voices — not instant clones or library PVC. */
function isFreeApiVoice(category: string | null | undefined): boolean {
  const c = (category || "").toLowerCase();
  return c === "premade" || c === "generated" || c === "";
}

function voiceMatchesLanguage(
  voice: VoiceOption,
  languageCode: string | null
): boolean {
  if (!languageCode) return true;
  const code = languageCode.toLowerCase();
  const lang = (voice.language || "").toLowerCase();
  if (!lang) return true; // unlabeled: keep available
  return lang === code || lang.startsWith(`${code}-`) || lang.startsWith(code);
}

type RawVoice = {
  voice_id?: string;
  name?: string;
  category?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string> | null;
  verified_languages?: Array<{
    language?: string;
    accent?: string | null;
    locale?: string | null;
  }> | null;
};

function mapAccountVoice(v: RawVoice): VoiceOption | null {
  if (!v.voice_id || !v.name) return null;
  const category = v.category ?? null;
  if (!isFreeApiVoice(category)) return null;
  const labels = v.labels ?? {};
  const verified = v.verified_languages?.[0];
  return {
    voiceId: v.voice_id,
    name: v.name,
    language: verified?.language || labels.language || null,
    accent: verified?.accent || labels.accent || null,
    previewUrl: v.preview_url ?? null,
    educational: isEducationalUseCase(labels.use_case),
    category,
  };
}

/** Free/default voices on the user's ElevenLabs account (My Voices). */
export async function listAccountVoices(
  apiKey: string
): Promise<{ ok: true; voices: VoiceOption[] } | ElevenLabsError> {
  // Prefer default voices; fall back to unfiltered list if the param is rejected
  const attempts = [
    new URLSearchParams({
      page_size: "100",
      include_total_count: "false",
      voice_type: "default",
    }),
    new URLSearchParams({
      page_size: "100",
      include_total_count: "false",
      category: "premade",
    }),
    new URLSearchParams({
      page_size: "100",
      include_total_count: "false",
    }),
  ];

  let lastError: ElevenLabsError | null = null;
  for (const params of attempts) {
    try {
      const res = await fetch(`${BASE}/v2/voices?${params}`, {
        headers: headers(apiKey),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        lastError = {
          ok: false,
          error: await readError(res),
          status: res.status,
        };
        continue;
      }
      const data = (await res.json()) as { voices?: RawVoice[] };
      const voices = (data.voices ?? [])
        .map(mapAccountVoice)
        .filter((v): v is VoiceOption => Boolean(v));
      if (voices.length > 0 || params.has("voice_type") === false) {
        return { ok: true, voices };
      }
    } catch (err) {
      lastError = {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to list voices",
      };
    }
  }
  return lastError ?? { ok: true, voices: [] };
}

/**
 * Free-plan-compatible voices on the account, preferred for the cue/answer language.
 * Instant clones and Voice Library voices are excluded (paid API only).
 */
export async function listVoicesForLanguage(
  apiKey: string,
  languageCode: string | null
): Promise<
  | {
      ok: true;
      voices: VoiceOption[];
      educationalOnly: boolean;
    }
  | ElevenLabsError
> {
  const account = await listAccountVoices(apiKey);
  if (!account.ok) return account;

  let pool = account.voices;
  if (languageCode) {
    const matched = pool.filter((v) => voiceMatchesLanguage(v, languageCode));
    if (matched.length > 0) pool = matched;
  }

  const educational = pool.filter((v) => v.educational);
  const voices = educational.length > 0 ? educational : pool;

  voices.sort((a, b) => {
    if (a.educational !== b.educational) return a.educational ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    ok: true,
    voices,
    educationalOnly: educational.length > 0,
  };
}

export async function synthesizeSpeech(
  apiKey: string,
  voiceId: string,
  text: string,
  languageCode: string | null
): Promise<{ ok: true; audio: Buffer; contentType: string } | ElevenLabsError> {
  const body: Record<string, unknown> = {
    text,
    model_id: TTS_MODEL,
  };
  if (languageCode) body.language_code = languageCode;

  try {
    const res = await fetch(
      `${BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          ...headers(apiKey, true),
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      }
    );
    if (!res.ok) {
      let msg = await readError(res);
      if (
        res.status === 402 ||
        /upgrade|subscription|instant|cloned|library|payment_required|free users/i.test(
          msg
        )
      ) {
        msg = `${msg} Tip: pick a free default/premade voice on Progress (Instant clones and library voices need a paid ElevenLabs plan).`;
      }
      return { ok: false, error: msg, status: res.status };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      audio: buf,
      contentType: res.headers.get("content-type") || "audio/mpeg",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "TTS failed",
    };
  }
}

/** Quick key check — list one page of voices. */
export async function validateApiKey(
  apiKey: string
): Promise<{ ok: true } | ElevenLabsError> {
  try {
    const res = await fetch(
      `${BASE}/v2/voices?page_size=1&include_total_count=false`,
      {
        headers: headers(apiKey),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res), status: res.status };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to validate API key",
    };
  }
}

export type TranscribeSpeechResult =
  | { ok: true; text: string; elapsedMs: number; provider: "elevenlabs" }
  | { ok: false; error: string; elapsedMs: number; status?: number };

/**
 * Transcribe a short spoken answer with Scribe v2.
 * Pass keyterms (e.g. the expected vocab word) to bias recognition.
 */
export async function transcribeSpeech(
  apiKey: string,
  audio: Blob,
  filename: string,
  options?: {
    languageCode?: string | null;
    keyterms?: string[];
  }
): Promise<TranscribeSpeechResult> {
  const started = Date.now();
  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("file", audio, filename || "answer.webm");
  form.append("tag_audio_events", "false");
  form.append("no_verbatim", "true");
  if (options?.languageCode) {
    form.append("language_code", options.languageCode);
  }
  for (const term of options?.keyterms ?? []) {
    const t = term.trim();
    if (t && t.length < 50) form.append("keyterms", t);
  }

  try {
    const res = await fetch(`${BASE}/v1/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        error: await readError(res),
        elapsedMs,
        status: res.status,
      };
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    if (!text) {
      return {
        ok: false,
        error: "ElevenLabs returned an empty transcript",
        elapsedMs,
      };
    }
    return { ok: true, text, elapsedMs, provider: "elevenlabs" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "ElevenLabs STT failed",
      elapsedMs: Date.now() - started,
    };
  }
}
