import type { FormEvent } from "react";
import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../Toast";

export function AuthPage() {
  const { setUser, inviteRequired, scriberr, lmStudio } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [promptLang, setPromptLang] = useState("English");
  const [answerLang, setAnswerLang] = useState("Spanish");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { user } = await api.login({ username, password });
        setUser(user);
      } else {
        const { user } = await api.register({
          username,
          password,
          inviteCode: inviteCode || undefined,
          promptLang,
          answerLang,
        });
        setUser(user);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Family Vocab</p>
        <h1>Learn together</h1>
        <p className="lede">
          Any language pair you choose — see a cue, answer by typing or speaking.
          Progress stays on this household server.
        </p>

        <div className="tabs">
          <button
            type="button"
            className={mode === "login" ? "tab active" : "tab"}
            onClick={() => setMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === "register" ? "tab active" : "tab"}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form onSubmit={onSubmit} className="stack">
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              minLength={6}
            />
          </label>
          {mode === "register" && (
            <>
              <div className="lang-row">
                <label>
                  Cue language
                  <input
                    value={promptLang}
                    onChange={(e) => setPromptLang(e.target.value)}
                    placeholder="English"
                    required
                  />
                </label>
                <label>
                  Answer language
                  <input
                    value={answerLang}
                    onChange={(e) => setAnswerLang(e.target.value)}
                    placeholder="Spanish"
                    required
                  />
                </label>
              </div>
              <p className="hint">
                Example: cue English, answer Spanish. Change anytime in
                Progress.
              </p>
            </>
          )}
          {mode === "register" && inviteRequired && (
            <label>
              Invite code
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
              />
            </label>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <div className="status-row">
          <span className={scriberr ? "ok" : "warn"}>
            Scriberr {scriberr ? "on" : "off"}
          </span>
          <span className={lmStudio ? "ok" : "warn"}>
            LM Studio {lmStudio ? "on" : "off"}
          </span>
        </div>
      </div>
    </div>
  );
}
