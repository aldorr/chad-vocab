export type GradeResult = {
  correct: boolean;
  reason: string;
  method: "exact" | "gemma" | "fallback";
};

function openaiBase() {
  return (process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1").replace(
    /\/$/,
    ""
  );
}

function lmRoot() {
  return openaiBase().replace(/\/v1$/, "");
}

function preferredModel() {
  return (process.env.LM_STUDIO_MODEL || "gemma").trim();
}

let loadInFlight: Promise<string | null> | null = null;

function isNoModelError(msg: string) {
  return (
    /no models loaded/i.test(msg) ||
    /please load a model/i.test(msg) ||
    /model_not_found/i.test(msg) ||
    /does not exist/i.test(msg)
  );
}

type CatalogModel = {
  key: string;
  displayName: string;
  loadedId?: string;
};

/** Prefer native catalog so "gemma" resolves to e.g. google/gemma-4-12b-qat. */
async function listCatalog(): Promise<CatalogModel[]> {
  try {
    const res = await fetch(`${lmRoot()}/api/v1/models`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        models?: {
          type?: string;
          key?: string;
          display_name?: string;
          loaded_instances?: { id?: string }[];
        }[];
      };
      return (data.models ?? [])
        .filter((m) => m.type !== "embedding" && m.key)
        .map((m) => ({
          key: m.key!,
          displayName: m.display_name || m.key!,
          loadedId: m.loaded_instances?.[0]?.id,
        }));
    }
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch(`${openaiBase()}/models`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id?: string }[] };
    return (data.data ?? [])
      .filter((m): m is { id: string } => Boolean(m.id))
      .map((m) => ({ key: m.id, displayName: m.id }));
  } catch {
    return [];
  }
}

function scoreMatch(hint: string, model: CatalogModel): number {
  const h = hint.toLowerCase();
  const key = model.key.toLowerCase();
  const name = model.displayName.toLowerCase();
  if (key === h || name === h) return 100;
  if (key.includes(h) || name.includes(h)) return 80;
  // "Gemma" / "gemma-3" style tokens
  const tokens = h.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length && tokens.every((t) => key.includes(t) || name.includes(t))) {
    return 60;
  }
  return 0;
}

/**
 * Map LM_STUDIO_MODEL hint → concrete model key.
 * If a matching model is already loaded, return that instance id.
 */
async function resolveModelId(hint: string): Promise<{
  key: string;
  alreadyLoaded: boolean;
} | null> {
  const catalog = await listCatalog();
  if (catalog.length === 0) {
    return hint ? { key: hint, alreadyLoaded: false } : null;
  }

  const ranked = catalog
    .map((m) => ({ m, score: scoreMatch(hint, m) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.m;
  if (!best) {
    // Hint didn't match — still try exact chat with hint (user may use full key)
    const exact = catalog.find((m) => m.key === hint);
    return exact
      ? { key: exact.loadedId || exact.key, alreadyLoaded: Boolean(exact.loadedId) }
      : { key: hint, alreadyLoaded: false };
  }

  if (best.loadedId) {
    return { key: best.loadedId, alreadyLoaded: true };
  }
  return { key: best.key, alreadyLoaded: false };
}

async function loadModel(modelKey: string): Promise<string | null> {
  if (loadInFlight) return loadInFlight;
  loadInFlight = (async () => {
    try {
      const res = await fetch(`${lmRoot()}/api/v1/models/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelKey,
          context_length: 4096,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        const body = await res.text();
        console.warn(
          `[lmstudio] load failed for ${modelKey} (${res.status}): ${body.slice(0, 240)}`
        );
        return null;
      }
      const data = (await res.json()) as {
        instance_id?: string;
        status?: string;
      };
      console.info(
        `[lmstudio] loaded ${data.instance_id || modelKey} (${data.status || "ok"})`
      );
      return data.instance_id || modelKey;
    } catch (err) {
      console.warn(
        "[lmstudio] load error:",
        err instanceof Error ? err.message : err
      );
      return null;
    } finally {
      loadInFlight = null;
    }
  })();
  return loadInFlight;
}

/** Resolve env hint and load into memory if needed. */
async function ensureReadyModel(): Promise<string | null> {
  const hint = preferredModel();
  const resolved = await resolveModelId(hint);
  if (!resolved) return null;
  if (resolved.alreadyLoaded) return resolved.key;
  return (await loadModel(resolved.key)) || resolved.key;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseGradePayload(
  content: string,
  reasoning = ""
): { correct: boolean; reason: string } | null {
  const sources = [stripCodeFence(content), content.trim(), reasoning.trim()].filter(
    Boolean
  );

  for (const src of sources) {
    const jsonMatch = src.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        correct?: boolean;
        reason?: string;
      };
      if (typeof parsed.correct === "boolean") {
        return {
          correct: parsed.correct,
          reason:
            parsed.reason ||
            (parsed.correct ? "Accepted" : "Not accepted"),
        };
      }
    } catch {
      /* try next source */
    }
  }

  // Reasoning-only models sometimes answer in prose
  const blob = `${content}\n${reasoning}`.toLowerCase();
  if (/\bcorrect:\s*true\b/.test(blob) || /\b"correct"\s*:\s*true\b/.test(blob)) {
    return { correct: true, reason: "Accepted by model" };
  }
  if (/\bcorrect:\s*false\b/.test(blob) || /\b"correct"\s*:\s*false\b/.test(blob)) {
    return { correct: false, reason: "Not accepted by model" };
  }

  return null;
}

async function chatGrade(
  model: string,
  system: string,
  user: string
): Promise<
  | { ok: true; content: string; reasoning: string }
  | { ok: false; error: string }
> {
  const res = await fetch(`${openaiBase()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 160,
      // Gemma 4 otherwise burns tokens on reasoning and truncates JSON
      reasoning_effort: "none",
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `LM Studio ${res.status}: ${text.slice(0, 200)}` };
  }

  const data = (await res.json()) as {
    choices?: {
      message?: { content?: string; reasoning_content?: string };
    }[];
  };
  const message = data.choices?.[0]?.message;
  const content = message?.content?.trim() ?? "";
  const reasoning = message?.reasoning_content?.trim() ?? "";
  return { ok: true, content, reasoning };
}

export async function gradeWithGemma(
  expectedAnswer: string,
  given: string,
  promptText: string,
  promptLang: string,
  answerLang: string
): Promise<GradeResult> {
  const system = `You grade vocabulary answers for language learners.
Reply with ONLY one line of valid JSON (no markdown): {"correct":boolean,"reason":"short English explanation"}
The learner sees a cue in ${promptLang} and must answer in ${answerLang}.
Accept correct ${answerLang} including optional articles, minor typos, and close synonyms for the same meaning.
Reject wrong words or answers in the wrong language.`;

  const user = `${promptLang} cue: ${promptText}
Expected ${answerLang}: ${expectedAnswer}
Learner answer: ${given}`;

  try {
    // Resolve "gemma" → google/gemma-… and load if nothing is in memory
    let model = (await ensureReadyModel()) || preferredModel();
    let result = await chatGrade(model, system, user);

    if (!result.ok && isNoModelError(result.error)) {
      const loaded = await ensureReadyModel();
      if (loaded) {
        model = loaded;
        result = await chatGrade(model, system, user);
      }
    }

    if (!result.ok) {
      throw new Error(result.error);
    }

    const parsed = parseGradePayload(result.content, result.reasoning);
    if (!parsed) {
      return {
        correct: false,
        reason:
          "Fuzzy grading returned an unreadable response. Exact match only for now.",
        method: "fallback",
      };
    }
    return {
      correct: parsed.correct,
      reason: parsed.reason,
      method: "gemma",
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "LM Studio unavailable";
    const noModel = isNoModelError(raw);
    const reason = noModel
      ? `Fuzzy grading unavailable — could not load “${preferredModel()}” in LM Studio. Exact match only for now.`
      : `Fuzzy grading unavailable (${raw.slice(0, 120)}). Exact match only for now.`;
    return {
      correct: false,
      reason,
      method: "fallback",
    };
  }
}

export type VocabPair = { answer: string; prompt: string };

export type ExtractPairsResult =
  | { ok: true; pairs: VocabPair[] }
  | { ok: false; error: string };

function parsePairsPayload(content: string, reasoning = ""): VocabPair[] | null {
  const sources = [stripCodeFence(content), content.trim(), reasoning.trim()].filter(
    Boolean
  );

  const fromArray = (parsed: unknown): VocabPair[] | null => {
    if (!Array.isArray(parsed)) return null;
    const pairs: VocabPair[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const answer = String(
        row.answer ?? row.target ?? row.learning ?? row.word ?? ""
      ).trim();
      const prompt = String(
        row.prompt ?? row.cue ?? row.translation ?? row.meaning ?? ""
      ).trim();
      if (answer && prompt) pairs.push({ answer, prompt });
    }
    return pairs.length > 0 ? pairs : null;
  };

  for (const src of sources) {
    const arrayMatch = src.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const pairs = fromArray(JSON.parse(arrayMatch[0]));
        if (pairs) return pairs;
      } catch {
        /* try object wrapper */
      }
    }
    const objMatch = src.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const obj = JSON.parse(objMatch[0]) as Record<string, unknown>;
        const nested = obj.pairs ?? obj.words ?? obj.vocabulary ?? obj.items;
        const pairs = fromArray(nested);
        if (pairs) return pairs;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

/**
 * Extract vocab pairs from a textbook photo via Gemma 3 (or other) vision model.
 * Prefer JPEG/PNG; models often normalize to ~896×896 so crop tightly to the list.
 */
export async function extractPairsFromImage(opts: {
  base64: string;
  mime: string;
  promptLang: string;
  answerLang: string;
}): Promise<ExtractPairsResult> {
  const mime = opts.mime.toLowerCase().startsWith("image/")
    ? opts.mime.toLowerCase()
    : "image/jpeg";
  // Prefer JPEG/PNG for the vision API
  const safeMime =
    mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg"
      ? mime === "image/jpg"
        ? "image/jpeg"
        : mime
      : "image/jpeg";

  if (
    mime.includes("heic") ||
    mime.includes("heif") ||
    mime.includes("webp") ||
    mime.includes("avif")
  ) {
    return {
      ok: false,
      error:
        "That image format often fails in LM Studio. Use JPEG/PNG (the app converts when the browser can).",
    };
  }

  const system = `You extract bilingual vocabulary lists from textbook photos for language learners.
Return ONLY a JSON array (no markdown, no commentary): [{"answer":"...","prompt":"..."},...]
- "answer" = the ${opts.answerLang} word/phrase (learning language)
- "prompt" = the ${opts.promptLang} cue/translation
Ignore page numbers, exercise instructions, grammar notes, and unrelated text.
Skip incomplete or unreadable rows. Deduplicate identical pairs.`;

  const userText = `Read the vocabulary list in this image. Extract every clear ${opts.answerLang} ↔ ${opts.promptLang} pair as JSON.`;

  try {
    let model = (await ensureReadyModel()) || preferredModel();

    const body = {
      model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            {
              type: "image_url",
              image_url: {
                url: `data:${safeMime};base64,${opts.base64}`,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 2048,
      reasoning_effort: "none",
    };

    const call = async (modelId: string) => {
      const res = await fetch(`${openaiBase()}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model: modelId }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false as const,
          error: `LM Studio ${res.status}: ${text.slice(0, 300)}`,
        };
      }
      const data = (await res.json()) as {
        choices?: {
          message?: { content?: string; reasoning_content?: string };
        }[];
        error?: string | { message?: string };
      };
      if (data.error) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : data.error.message || JSON.stringify(data.error);
        return { ok: false as const, error: msg };
      }
      const message = data.choices?.[0]?.message;
      return {
        ok: true as const,
        content: message?.content?.trim() ?? "",
        reasoning: message?.reasoning_content?.trim() ?? "",
      };
    };

    let result = await call(model);
    if (!result.ok && isNoModelError(result.error)) {
      const loaded = await ensureReadyModel();
      if (loaded) {
        model = loaded;
        result = await call(model);
      }
    }

    if (!result.ok) {
      const err = result.error;
      if (/ffprobe|mtmd|decode buffer|channel error/i.test(err)) {
        return {
          ok: false,
          error:
            "LM Studio couldn’t decode the photo (often HEIC/WebP, or missing ffmpeg/ffprobe in LM Studio’s PATH). Retake as JPEG/PNG, or install ffmpeg and restart LM Studio.",
        };
      }
      if (/vision|image|multimodal|not support/i.test(err)) {
        return {
          ok: false,
          error:
            "Photo scan needs a vision-capable model in LM Studio (e.g. Gemma 3/4 with Vision Input). Load one and try again.",
        };
      }
      return { ok: false, error: err };
    }

    const pairs = parsePairsPayload(result.content, result.reasoning);
    if (!pairs) {
      return {
        ok: false,
        error:
          "Could not read vocabulary pairs from the model response. Try a clearer JPEG/PNG crop of the list.",
      };
    }
    return { ok: true, pairs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LM Studio unavailable";
    if (/ffprobe|mtmd|channel error/i.test(msg)) {
      return {
        ok: false,
        error:
          "LM Studio couldn’t decode the photo. Use JPEG/PNG, and ensure ffmpeg/ffprobe is available to LM Studio (Homebrew: `brew install ffmpeg`, then restart LM Studio).",
      };
    }
    return {
      ok: false,
      error: `Photo scan failed: ${msg}. Is LM Studio running with a vision model loaded?`,
    };
  }
}

