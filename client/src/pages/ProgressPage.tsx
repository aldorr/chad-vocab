import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { api, type Progress, type VoiceOption } from "../api";
import { useAuth } from "../auth";
import { DeckSwitcher } from "../DeckSwitcher";
import { InfoTip } from "../InfoTip";
import { useToast } from "../Toast";

function voiceLabel(v: VoiceOption): string {
  const bits = [v.name];
  if (v.accent) bits.push(v.accent);
  else if (v.language) bits.push(v.language);
  if (v.educational) bits.push("educational");
  return bits.join(" · ");
}

export function ProgressPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [promptLang, setPromptLang] = useState(user?.promptLang ?? "German");
  const [answerLang, setAnswerLang] = useState(user?.answerLang ?? "Spanish");
  const [msg, setMsg] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [promptVoices, setPromptVoices] = useState<VoiceOption[]>([]);
  const [answerVoices, setAnswerVoices] = useState<VoiceOption[]>([]);
  const [educationalOnly, setEducationalOnly] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [savingVoice, setSavingVoice] = useState<"prompt" | "answer" | null>(
    null
  );

  const hasKey = Boolean(user?.elevenlabsKeyHint);

  useEffect(() => {
    void api
      .progress()
      .then(setProgress)
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to load progress")
      );
  }, [toast]);

  useEffect(() => {
    if (user) {
      setPromptLang(user.promptLang);
      setAnswerLang(user.answerLang);
    }
  }, [user]);

  useEffect(() => {
    if (!hasKey) {
      setPromptVoices([]);
      setAnswerVoices([]);
      setEducationalOnly(false);
      return;
    }
    let cancelled = false;
    setLoadingVoices(true);
    void Promise.all([
      api.listElevenlabsVoices("prompt"),
      api.listElevenlabsVoices("answer"),
    ])
      .then(([p, a]) => {
        if (cancelled) return;
        setPromptVoices(p.voices);
        setAnswerVoices(a.voices);
        setEducationalOnly(p.educationalOnly || a.educationalOnly);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : "Failed to load ElevenLabs voices"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingVoices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasKey, user?.promptLang, user?.answerLang, toast]);

  async function saveLangs(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const { user: updated } = await api.updateSettings({
        promptLang,
        answerLang,
      });
      setUser(updated);
      setMsg(
        "Language pair saved — open Deck and load a matching sample if needed."
      );
      toast.ok(`Languages set to ${updated.answerLang} ← ${updated.promptLang}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function saveApiKey(e: FormEvent) {
    e.preventDefault();
    if (!apiKeyInput.trim()) {
      toast.error("Paste your ElevenLabs API key");
      return;
    }
    setSavingKey(true);
    try {
      const { user: updated } = await api.updateSettings({
        elevenlabsApiKey: apiKeyInput.trim(),
      });
      setUser(updated);
      setApiKeyInput("");
      toast.ok("ElevenLabs key saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingKey(false);
    }
  }

  async function removeApiKey() {
    setSavingKey(true);
    try {
      const { user: updated } = await api.updateSettings({
        clearElevenlabsKey: true,
      });
      setUser(updated);
      setPromptVoices([]);
      setAnswerVoices([]);
      toast.ok("ElevenLabs key removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove key");
    } finally {
      setSavingKey(false);
    }
  }

  async function pickVoice(side: "prompt" | "answer", voiceId: string) {
    const list = side === "prompt" ? promptVoices : answerVoices;
    const voice = list.find((v) => v.voiceId === voiceId);
    if (!voice) return;
    setSavingVoice(side);
    try {
      const body =
        side === "prompt"
          ? {
              promptVoiceId: voice.voiceId,
              promptVoiceName: voice.name,
            }
          : {
              answerVoiceId: voice.voiceId,
              answerVoiceName: voice.name,
            };
      const { user: updated } = await api.updateSettings(body);
      setUser(updated);
      toast.ok(
        `${side === "prompt" ? "Cue" : "Answer"} voice: ${voice.name}${
          voice.accent ? ` (${voice.accent})` : ""
        }`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save voice");
    } finally {
      setSavingVoice(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Progress</h1>
        <p>Points now — play modes and leaderboards next.</p>
      </header>

      {progress && (
        <div className="stats-grid">
          <div className="stat">
            <span className="stat-num">{progress.learned}</span>
            <span className="stat-label">Learned</span>
          </div>
          <div className="stat">
            <span className="stat-num">{progress.unlearned}</span>
            <span className="stat-label">Still learning</span>
          </div>
          <div className="stat">
            <span className="stat-num">{user?.pointsTotal ?? 0}</span>
            <span className="stat-label">Points</span>
          </div>
          <div className="stat">
            <span className="stat-num">{progress.total}</span>
            <span className="stat-label">In deck</span>
          </div>
        </div>
      )}

      {progress && progress.unlearned > 0 && progress.unlearned <= 5 && (
        <p className="ok">
          Last {progress.unlearned} — practice will mix these with learned
          words until they stick.
        </p>
      )}

      <DeckSwitcher
        onDeckChange={() => {
          void api
            .progress()
            .then(setProgress)
            .catch((e) =>
              toast.error(
                e instanceof Error ? e.message : "Failed to load progress"
              )
            );
        }}
      />

      <form onSubmit={saveLangs} className="settings-box stack">
        <h2>Language pair (this deck)</h2>
        <p className="hint">
          Cue = language you see/hear. Answer = language you type or speak.
          Saves on the <strong>active</strong> deck only. Use{" "}
          <strong>New deck</strong> above for a separate language pair and card
          list. Each account has its own decks.
        </p>
        <div className="lang-row">
          <label>
            Cue language
            <input
              value={promptLang}
              onChange={(e) => setPromptLang(e.target.value)}
              required
            />
          </label>
          <label>
            Answer language
            <input
              value={answerLang}
              onChange={(e) => setAnswerLang(e.target.value)}
              required
            />
          </label>
        </div>
        <button type="submit" className="btn primary">
          Save languages
        </button>
        {msg && <p className="ok">{msg}</p>}
      </form>

      <section className="settings-box stack">
        <h2 className="settings-heading">
          ElevenLabs
          <InfoTip label="How to set up ElevenLabs">
            <p>
              Optional. Your own key unlocks word audio (TTS) and faster spoken
              answers (Scribe). Without a key, practice still works with local
              Scriberr.
            </p>
            <ol>
              <li>
                Create an account at{" "}
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  elevenlabs.io
                </a>
                .
              </li>
              <li>
                Create an API key with at least:{" "}
                <strong>Text to Speech</strong>, <strong>Speech to Text</strong>
                , <strong>Voices (Read)</strong>, and{" "}
                <strong>Models (Read)</strong>. A full-access key also works.
              </li>
              <li>Paste the key below (it is stored encrypted on this server).</li>
              <li>
                Pick cue and answer voices from the free{" "}
                <strong>default / premade</strong> voices on your account
                (Rachel, Adam, etc.). Instant Voice Clones and Voice Library
                voices need a paid ElevenLabs plan for API use.
              </li>
            </ol>
          </InfoTip>
        </h2>

        <div className="settings-subhead">
          <h3>API key</h3>
          {!hasKey && (
            <InfoTip label="API key instructions">
              <p>
                Paste an ElevenLabs API key to enable cloud TTS and speech
                recognition for this user only.
              </p>
              <p>
                Required permissions: <strong>text_to_speech</strong>,{" "}
                <strong>speech_to_text</strong>, <strong>voices_read</strong>,{" "}
                <strong>models_read</strong> (or grant unrestricted / “all”).
              </p>
              <p>
                Create one under Profile → API Keys. The key is never shown
                again after you save — only a short hint like{" "}
                <code>…ab12</code>.
              </p>
            </InfoTip>
          )}
        </div>

        {hasKey ? (
          <div className="row-actions voice-key-row">
            <span className="muted">
              Key saved: <code>{user?.elevenlabsKeyHint}</code>
            </span>
            <button
              type="button"
              className="btn ghost"
              disabled={savingKey}
              onClick={() => void removeApiKey()}
            >
              Remove key
            </button>
          </div>
        ) : (
          <form onSubmit={saveApiKey} className="stack">
            <label>
              API key
              <input
                type="password"
                autoComplete="off"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="xi-…"
              />
            </label>
            <button
              type="submit"
              className="btn primary"
              disabled={savingKey || !apiKeyInput.trim()}
            >
              {savingKey ? "Saving…" : "Save key"}
            </button>
          </form>
        )}

        {hasKey && (
          <>
            <div className="settings-subhead">
              <h3>Voices</h3>
              <InfoTip label="How to pick free voices">
                <p>
                  On the free plan, the API only allows{" "}
                  <strong>default / premade</strong> voices (and some generated
                  ones). Instant Voice Clones and Voice Library voices return
                  “upgrade your subscription” when used via API.
                </p>
                <ol>
                  <li>
                    In ElevenLabs, open{" "}
                    <a
                      href="https://elevenlabs.io/app/voice-lab"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Voices
                    </a>{" "}
                    and use the built-in default voices.
                  </li>
                  <li>
                    Refresh this page and pick a cue voice and an answer voice
                    below.
                  </li>
                </ol>
                <p>
                  Multilingual default voices usually work for any language
                  pair; pick two that sound clear for learning.
                </p>
              </InfoTip>
            </div>

            {loadingVoices ? (
              <p className="muted">Loading voices…</p>
            ) : promptVoices.length === 0 && answerVoices.length === 0 ? (
              <p className="hint">
                No free (default/premade) voices found on this API key. Instant
                clones and Voice Library voices need a paid plan — pick a default
                voice in ElevenLabs Voices, then refresh.
              </p>
            ) : (
              <div className="voice-pickers">
                <label>
                  Cue voice ({user?.promptLang})
                  <select
                    value={
                      promptVoices.some((v) => v.voiceId === user?.promptVoiceId)
                        ? (user?.promptVoiceId ?? "")
                        : ""
                    }
                    disabled={savingVoice === "prompt"}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) void pickVoice("prompt", id);
                    }}
                  >
                    <option value="">Choose a voice…</option>
                    {promptVoices.map((v) => (
                      <option key={v.voiceId} value={v.voiceId}>
                        {voiceLabel(v)}
                      </option>
                    ))}
                  </select>
                  {user?.promptVoiceName &&
                    !promptVoices.some(
                      (v) => v.voiceId === user.promptVoiceId
                    ) && (
                      <span className="muted voice-current">
                        Previous pick “{user.promptVoiceName}” isn’t free-plan
                        compatible — choose another.
                      </span>
                    )}
                  {user?.promptVoiceName &&
                    promptVoices.some(
                      (v) => v.voiceId === user.promptVoiceId
                    ) && (
                      <span className="muted voice-current">
                        Selected: {user.promptVoiceName}
                      </span>
                    )}
                </label>
                <label>
                  Answer voice ({user?.answerLang})
                  <select
                    value={
                      answerVoices.some((v) => v.voiceId === user?.answerVoiceId)
                        ? (user?.answerVoiceId ?? "")
                        : ""
                    }
                    disabled={savingVoice === "answer"}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) void pickVoice("answer", id);
                    }}
                  >
                    <option value="">Choose a voice…</option>
                    {answerVoices.map((v) => (
                      <option key={v.voiceId} value={v.voiceId}>
                        {voiceLabel(v)}
                      </option>
                    ))}
                  </select>
                  {user?.answerVoiceName &&
                    !answerVoices.some(
                      (v) => v.voiceId === user.answerVoiceId
                    ) && (
                      <span className="muted voice-current">
                        Previous pick “{user.answerVoiceName}” isn’t free-plan
                        compatible — choose another.
                      </span>
                    )}
                  {user?.answerVoiceName &&
                    answerVoices.some(
                      (v) => v.voiceId === user.answerVoiceId
                    ) && (
                      <span className="muted voice-current">
                        Selected: {user.answerVoiceName}
                      </span>
                    )}
                </label>
              </div>
            )}

            {!loadingVoices &&
              (promptVoices.length > 0 || answerVoices.length > 0) && (
                <p className="hint">
                  Showing free default/premade voices only
                  {educationalOnly ? " (Educational labels preferred)." : "."}{" "}
                  Instant clones and library voices are hidden — they need a paid
                  ElevenLabs plan for API use.
                </p>
              )}

            {user?.promptVoiceId &&
              promptVoices.find((v) => v.voiceId === user.promptVoiceId)
                ?.previewUrl && (
                <audio
                  controls
                  src={
                    promptVoices.find((v) => v.voiceId === user.promptVoiceId)!
                      .previewUrl!
                  }
                />
              )}
            {user?.answerVoiceId &&
              answerVoices.find((v) => v.voiceId === user.answerVoiceId)
                ?.previewUrl && (
                <audio
                  controls
                  src={
                    answerVoices.find((v) => v.voiceId === user.answerVoiceId)!
                      .previewUrl!
                  }
                />
              )}
          </>
        )}
      </section>
    </div>
  );
}
