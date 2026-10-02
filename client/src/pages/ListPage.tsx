import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { api, type AudioSide, type Card } from "../api";
import { useAuth } from "../auth";
import { sampleImportText } from "../samplePairs";
import { normalizePhotoForScan } from "../normalizePhoto";
import { useToast } from "../Toast";

type ScanRow = {
  id: string;
  answer: string;
  prompt: string;
  include: boolean;
};

function speechReady(user: {
  elevenlabsKeyHint: string | null;
  promptVoiceId: string | null;
  answerVoiceId: string | null;
} | null): boolean {
  return Boolean(
    user?.elevenlabsKeyHint && user.promptVoiceId && user.answerVoiceId
  );
}

export function ListPage() {
  const { user } = useAuth();
  const toast = useToast();
  const answerLang = user?.answerLang ?? "Answer";
  const promptLang = user?.promptLang ?? "Cue";
  const canGenerate = speechReady(user);
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState(() =>
    sampleImportText(answerLang, promptLang)
  );
  const [msg, setMsg] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanRows, setScanRows] = useState<ScanRow[] | null>(null);
  const [importingScan, setImportingScan] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genLabel, setGenLabel] = useState("");
  const sampleKey = useRef(`${answerLang}|${promptLang}`);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const { cards: list } = await api.listCards();
    setCards(list);
  }

  useEffect(() => {
    void load().catch((e) =>
      toast.error(e instanceof Error ? e.message : "Failed to load deck")
    );
  }, [toast]);

  useEffect(() => {
    const nextKey = `${answerLang}|${promptLang}`;
    if (sampleKey.current === nextKey) return;
    const prevSample = sampleImportText(
      sampleKey.current.split("|")[0] || "Spanish",
      sampleKey.current.split("|")[1] || "German"
    );
    setText((current) =>
      current.trim() === prevSample.trim() || current.trim() === ""
        ? sampleImportText(answerLang, promptLang)
        : current
    );
    sampleKey.current = nextKey;
  }, [answerLang, promptLang]);

  async function generateMissing(cardIds?: string[]) {
    if (!canGenerate) return;
    setGenerating(true);
    setGenLabel("Generating word audio…");
    try {
      const res = await api.generateAudio(
        cardIds?.length ? { cardIds } : undefined
      );
      await load();
      if (res.generated > 0) {
        toast.ok(
          `Generated ${res.generated} clip${res.generated === 1 ? "" : "s"}`
        );
      }
      if (res.failed > 0) {
        toast.error(
          res.errors[0] ||
            `Failed to generate ${res.failed} clip${res.failed === 1 ? "" : "s"}`
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Audio generation failed"
      );
    } finally {
      setGenerating(false);
      setGenLabel("");
    }
  }

  async function regenerateCard(id: string) {
    if (!canGenerate) {
      toast.error("Add an ElevenLabs key and voices on Progress first");
      return;
    }
    setGenerating(true);
    setGenLabel("Regenerating…");
    try {
      const res = await api.generateAudio({
        cardIds: [id],
        regenerate: true,
      });
      await load();
      if (res.generated > 0) toast.ok("Audio regenerated");
      if (res.failed > 0) {
        toast.error(res.errors[0] || "Regenerate failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regenerate failed");
    } finally {
      setGenerating(false);
      setGenLabel("");
    }
  }

  async function onImport(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const res = await api.importCards(text);
      setMsg(`Added ${res.added}, skipped ${res.skipped}`);
      toast.ok(`Imported ${res.added} card(s)`);
      await load();
      if (res.added > 0 && canGenerate) {
        await generateMissing();
      } else if (res.added > 0 && !canGenerate) {
        toast.ok("Tip: add ElevenLabs on Progress to auto-speak new words");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteCard(id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function clearAudio(id: string, side: AudioSide) {
    try {
      await api.deleteAudio(id, side);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear audio");
    }
  }

  function useMatchingSample() {
    setText(sampleImportText(answerLang, promptLang));
    sampleKey.current = `${answerLang}|${promptLang}`;
  }

  async function handlePhotoFile(file: File | undefined | null) {
    if (!file) return;
    // Allow empty type (some cameras); reject obvious non-images
    if (file.type && !file.type.startsWith("image/")) {
      toast.error("Please choose a photo of the vocab list (JPEG or PNG)");
      return;
    }
    setScanning(true);
    setScanRows(null);
    try {
      const jpeg = await normalizePhotoForScan(file);
      const res = await api.scanPhoto(jpeg, jpeg.name);
      if (!res.pairs.length) {
        toast.error("No vocabulary pairs found — try a clearer crop");
        return;
      }
      setScanRows(
        res.pairs.map((p, i) => ({
          id: `scan-${i}-${p.answer}-${p.prompt}`,
          answer: p.answer,
          prompt: p.prompt,
          include: true,
        }))
      );
      toast.ok(`Found ${res.pairs.length} pair(s) — review before importing`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Photo scan failed");
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  function updateScanRow(
    id: string,
    patch: Partial<Pick<ScanRow, "answer" | "prompt" | "include">>
  ) {
    setScanRows((rows) =>
      rows
        ? rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
        : rows
    );
  }

  function dismissScan() {
    setScanRows(null);
  }

  async function confirmScanImport() {
    if (!scanRows) return;
    const lines = scanRows
      .filter((r) => r.include && r.answer.trim() && r.prompt.trim())
      .map((r) => `${r.answer.trim()} | ${r.prompt.trim()}`);
    if (lines.length === 0) {
      toast.error("Select at least one pair to import");
      return;
    }
    setImportingScan(true);
    try {
      const res = await api.importCards(lines.join("\n"));
      setMsg(`Added ${res.added}, skipped ${res.skipped}`);
      toast.ok(`Imported ${res.added} card(s) from photo`);
      setScanRows(null);
      await load();
      if (res.added > 0 && canGenerate) {
        await generateMissing();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingScan(false);
    }
  }

  function WordAudioRow({
    cardId,
    side,
    word,
    langLabel,
    hasAudio,
    cacheKey,
  }: {
    cardId: string;
    side: AudioSide;
    word: string;
    langLabel: string;
    hasAudio: boolean;
    cacheKey: number;
  }) {
    return (
      <div className="word-audio-row">
        <div className="word-audio-label">
          <strong>{word}</strong>
          <span className="muted">{langLabel}</span>
        </div>
        <div className="row-actions">
          {hasAudio ? (
            <>
              <audio
                controls
                src={`/api/cards/${cardId}/audio/${side}?v=${cacheKey}`}
              />
              <button
                type="button"
                className="btn ghost"
                onClick={() => void clearAudio(cardId, side)}
              >
                Clear
              </button>
            </>
          ) : canGenerate ? (
            <span className="muted">No audio yet</span>
          ) : (
            <span className="muted">
              Add ElevenLabs on Progress to generate
            </span>
          )}
        </div>
      </div>
    );
  }

  const selectedCount =
    scanRows?.filter((r) => r.include && r.answer.trim() && r.prompt.trim())
      .length ?? 0;
  const missingAudio = cards.filter(
    (c) => !c.hasAnswerAudio || !c.hasPromptAudio
  ).length;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Your deck</h1>
        <p>
          Paste <strong>{answerLang}</strong> | <strong>{promptLang}</strong>{" "}
          pairs — one per line (learning language first). Or scan a textbook
          page with a local vision model. Word audio comes from ElevenLabs when
          you save a key and voices on Progress.
        </p>
      </header>

      <section className="scan-box">
        <div className="scan-head">
          <h2>Scan textbook page</h2>
          <p className="muted">
            Photo stays on this machine. Needs a Gemma 3 vision model in LM
            Studio. Prefer JPEG/PNG; crop tightly to the vocab list (leave a
            little margin — models may resize to ~896×896).
          </p>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="btn primary"
            disabled={scanning}
            onClick={() => cameraInputRef.current?.click()}
          >
            {scanning ? "Reading page…" : "Take photo"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={scanning}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose image
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/jpeg,image/png,image/*"
            capture="environment"
            hidden
            onChange={(e) => void handlePhotoFile(e.target.files?.[0])}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/*"
            hidden
            onChange={(e) => void handlePhotoFile(e.target.files?.[0])}
          />
        </div>
      </section>

      {scanRows && (
        <section className="scan-review" aria-label="Review scanned pairs">
          <div className="scan-review-head">
            <h2>Review before import</h2>
            <p className="muted">
              Edit anything wrong, uncheck junk, then import selected pairs.
            </p>
          </div>
          <ul className="scan-pair-list">
            {scanRows.map((row) => (
              <li key={row.id} className="scan-pair-row">
                <label className="scan-check">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) =>
                      updateScanRow(row.id, { include: e.target.checked })
                    }
                  />
                  <span className="sr-only">Include</span>
                </label>
                <input
                  className="scan-field"
                  value={row.answer}
                  disabled={!row.include}
                  aria-label={answerLang}
                  placeholder={answerLang}
                  onChange={(e) =>
                    updateScanRow(row.id, { answer: e.target.value })
                  }
                />
                <span className="scan-sep" aria-hidden>
                  |
                </span>
                <input
                  className="scan-field"
                  value={row.prompt}
                  disabled={!row.include}
                  aria-label={promptLang}
                  placeholder={promptLang}
                  onChange={(e) =>
                    updateScanRow(row.id, { prompt: e.target.value })
                  }
                />
              </li>
            ))}
          </ul>
          <div className="row-actions">
            <button
              type="button"
              className="btn primary"
              disabled={importingScan || selectedCount === 0}
              onClick={() => void confirmScanImport()}
            >
              {importingScan
                ? "Importing…"
                : `Import ${selectedCount} pair${selectedCount === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={importingScan}
              onClick={dismissScan}
            >
              Discard
            </button>
          </div>
        </section>
      )}

      <form onSubmit={onImport} className="import-box">
        <div className="import-toolbar">
          <button
            type="button"
            className="btn ghost"
            onClick={useMatchingSample}
          >
            Load {answerLang}←{promptLang} sample
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
        />
        <button type="submit" className="btn primary">
          Import into my list
        </button>
      </form>

      {msg && <p className="ok">{msg}</p>}
      {generating && <p className="muted">{genLabel || "Working…"}</p>}

      {canGenerate && missingAudio > 0 && !generating && (
        <div className="row-actions" style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            className="btn"
            onClick={() => void generateMissing()}
          >
            Generate missing audio ({missingAudio} card
            {missingAudio === 1 ? "" : "s"})
          </button>
        </div>
      )}

      <ul className="card-list">
        {cards.map((card) => (
          <li key={card.id} className="card-item">
            <div className="card-item-head">
              <span className={`badge ${card.status}`}>{card.status}</span>
              <div className="row-actions">
                {canGenerate && (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={generating}
                    onClick={() => void regenerateCard(card.id)}
                  >
                    Regenerate
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void remove(card.id)}
                >
                  Delete
                </button>
              </div>
            </div>
            <WordAudioRow
              cardId={card.id}
              side="answer"
              word={card.answer}
              langLabel={answerLang}
              hasAudio={card.hasAnswerAudio}
              cacheKey={card.updatedAt}
            />
            <WordAudioRow
              cardId={card.id}
              side="prompt"
              word={card.prompt}
              langLabel={promptLang}
              hasAudio={card.hasPromptAudio}
              cacheKey={card.updatedAt}
            />
          </li>
        ))}
        {cards.length === 0 && (
          <li className="muted">No cards yet — import a list above.</li>
        )}
      </ul>
    </div>
  );
}
