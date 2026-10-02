import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { api, type Progress } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../Toast";

export function ProgressPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [promptLang, setPromptLang] = useState(user?.promptLang ?? "German");
  const [answerLang, setAnswerLang] = useState(user?.answerLang ?? "Spanish");
  const [msg, setMsg] = useState("");

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

  async function saveLangs(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const { user: updated } = await api.updateSettings({
        promptLang,
        answerLang,
      });
      setUser(updated);
      setMsg("Language pair saved — open Deck and load a matching sample if needed.");
      toast.ok(`Languages set to ${updated.answerLang} ← ${updated.promptLang}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
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

      <form onSubmit={saveLangs} className="settings-box stack">
        <h2>Language pair</h2>
        <p className="hint">
          Cue = language you see/hear. Answer = language you type or speak.
          Changing this does not rewrite cards already in your deck.
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
    </div>
  );
}
