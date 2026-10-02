import { useCallback, useEffect, useState } from "react";
import { api, type Deck } from "./api";
import { useAuth } from "./auth";
import { flagForLang } from "./langFlags";
import { useToast } from "./Toast";

type Props = {
  /** Called after the active deck changes so pages can reload cards/progress. */
  onDeckChange?: () => void;
};

export function DeckSwitcher({ onDeckChange }: Props) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [promptLang, setPromptLang] = useState("English");
  const [answerLang, setAnswerLang] = useState("Spanish");

  const refresh = useCallback(async () => {
    const res = await api.listDecks();
    setDecks(res.decks);
    setUser(res.user);
  }, [setUser]);

  useEffect(() => {
    void refresh().catch((e) =>
      toast.error(e instanceof Error ? e.message : "Failed to load decks")
    );
  }, [refresh, toast]);

  async function activate(id: string) {
    if (id === user?.activeDeckId) return;
    setBusy(true);
    try {
      const res = await api.activateDeck(id);
      setUser(res.user);
      await refresh();
      onDeckChange?.();
      toast.ok(`Switched to ${res.deck.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch deck");
    } finally {
      setBusy(false);
    }
  }

  async function createDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!promptLang.trim() || !answerLang.trim()) return;
    setBusy(true);
    try {
      const res = await api.createDeck({
        promptLang: promptLang.trim(),
        answerLang: answerLang.trim(),
        activate: true,
      });
      setUser(res.user);
      setCreating(false);
      await refresh();
      onDeckChange?.();
      toast.ok(`Created ${res.deck.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create deck");
    } finally {
      setBusy(false);
    }
  }

  async function removeDeck(id: string) {
    if (decks.length <= 1) {
      toast.error("Keep at least one deck");
      return;
    }
    if (
      !window.confirm(
        "Delete this deck and all its cards? This cannot be undone."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.deleteDeck(id);
      setUser(res.user);
      await refresh();
      onDeckChange?.();
      toast.ok("Deck deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete deck");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deck-switcher">
      <div className="deck-switcher-row">
        <label className="deck-switcher-label">
          Active deck
          <select
            value={user?.activeDeckId ?? ""}
            disabled={busy || decks.length === 0}
            onChange={(e) => void activate(e.target.value)}
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {flagForLang(d.answerLang)} {d.answerLang} ←{" "}
                {flagForLang(d.promptLang)} {d.promptLang}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? "Cancel" : "New deck"}
        </button>
        {user?.activeDeckId && decks.length > 1 && (
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void removeDeck(user.activeDeckId!)}
          >
            Delete deck
          </button>
        )}
      </div>
      {creating && (
        <form className="deck-create" onSubmit={(e) => void createDeck(e)}>
          <p className="muted">
            Each deck has its own language pair and card list — other accounts
            keep their own decks too.
          </p>
          <div className="deck-create-fields">
            <label>
              Learning language
              <input
                value={answerLang}
                onChange={(e) => setAnswerLang(e.target.value)}
                placeholder="Spanish"
                required
              />
            </label>
            <label>
              Cue language
              <input
                value={promptLang}
                onChange={(e) => setPromptLang(e.target.value)}
                placeholder="English"
                required
              />
            </label>
          </div>
          <button type="submit" className="btn primary" disabled={busy}>
            Create &amp; switch
          </button>
        </form>
      )}
    </div>
  );
}
