import { useState } from "react";
import { api } from "./api";
import { AuthProvider, useAuth } from "./auth";
import { AuthPage } from "./pages/AuthPage";
import { ListPage } from "./pages/ListPage";
import { PracticePage } from "./pages/PracticePage";
import { ProgressPage } from "./pages/ProgressPage";
import { VocabBrokePage } from "./pages/VocabBrokePage";
import { flagForLang } from "./langFlags";
import { ToastProvider } from "./Toast";

type Tab = "deck" | "practice" | "progress";

function Shell() {
  const { user, loading, setUser, scriberr, lmStudio } = useAuth();
  const [tab, setTab] = useState<Tab>("practice");
  const [broke, setBroke] = useState(false);

  if (loading) {
    return (
      <div className="auth-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  if (broke) {
    return <VocabBrokePage onBack={() => setBroke(false)} />;
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  return (
    <div className="app-shell">
      <nav className="topnav">
        <div className="brand">
          <span className="brand-mark">FV</span>
          <div>
            <strong>Family Vocab</strong>
            <small>
              {flagForLang(user.answerLang)} {user.answerLang} ←{" "}
              {flagForLang(user.promptLang)} {user.promptLang} · @
              {user.username}
            </small>
          </div>
        </div>
        <div className="nav-tabs">
          {(
            [
              ["deck", "Deck"],
              ["practice", "Practice"],
              ["progress", "Progress"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "nav active" : "nav"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="nav-end">
          <span className="pts">{user.pointsTotal} pts</span>
          <span className={scriberr ? "dot ok" : "dot warn"} title="Scriberr" />
          <span className={lmStudio ? "dot ok" : "dot warn"} title="LM Studio" />
          <button
            type="button"
            className="btn ghost"
            onClick={() => setBroke(true)}
          >
            Light mode
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void logout()}
          >
            Log out
          </button>
        </div>
      </nav>
      <main>
        {tab === "deck" && <ListPage />}
        {tab === "practice" && <PracticePage />}
        {tab === "progress" && <ProgressPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ToastProvider>
  );
}
