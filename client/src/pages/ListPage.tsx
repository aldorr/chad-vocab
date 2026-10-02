import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { api, type AudioSide, type Card } from "../api";
import { useAuth } from "../auth";
import { sampleImportText } from "../samplePairs";
import { useToast } from "../Toast";

export function ListPage() {
  const { user } = useAuth();
  const toast = useToast();
  const answerLang = user?.answerLang ?? "Answer";
  const promptLang = user?.promptLang ?? "Cue";
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState(() =>
    sampleImportText(answerLang, promptLang)
  );
  const [msg, setMsg] = useState("");
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sampleKey = useRef(`${answerLang}|${promptLang}`);

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

  async function onImport(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const res = await api.importCards(text);
      setMsg(`Added ${res.added}, skipped ${res.skipped}`);
      toast.ok(`Imported ${res.added} card(s)`);
      await load();
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

  async function startRecord(id: string, side: AudioSide) {
    const key = `${id}:${side}`;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        try {
          await api.uploadAudio(id, side, blob);
          await load();
          toast.ok(
            `Saved ${side === "answer" ? answerLang : promptLang} recording`
          );
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Upload failed");
        }
        setRecordingKey(null);
      };
      mediaRef.current = rec;
      setRecordingKey(key);
      rec.start();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Microphone permission denied"
      );
    }
  }

  function stopRecord() {
    mediaRef.current?.stop();
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

  function WordAudioRow({
    cardId,
    side,
    word,
    langLabel,
    hasAudio,
  }: {
    cardId: string;
    side: AudioSide;
    word: string;
    langLabel: string;
    hasAudio: boolean;
  }) {
    const key = `${cardId}:${side}`;
    const recording = recordingKey === key;
    return (
      <div className="word-audio-row">
        <div className="word-audio-label">
          <strong>{word}</strong>
          <span className="muted">{langLabel}</span>
        </div>
        <div className="row-actions">
          {hasAudio ? (
            <>
              <audio controls src={`/api/cards/${cardId}/audio/${side}`} />
              <button
                type="button"
                className="btn ghost"
                onClick={() => void clearAudio(cardId, side)}
              >
                Clear
              </button>
            </>
          ) : recording ? (
            <button type="button" className="btn danger" onClick={stopRecord}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void startRecord(cardId, side)}
            >
              Record voice
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Your deck</h1>
        <p>
          Paste <strong>{answerLang}</strong> | <strong>{promptLang}</strong>{" "}
          pairs — one per line (learning language first). Record a voice for
          each side so practice can play audio cues.
        </p>
      </header>

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

      <ul className="card-list">
        {cards.map((card) => (
          <li key={card.id} className="card-item">
            <div className="card-item-head">
              <span className={`badge ${card.status}`}>{card.status}</span>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void remove(card.id)}
              >
                Delete
              </button>
            </div>
            <WordAudioRow
              cardId={card.id}
              side="answer"
              word={card.answer}
              langLabel={answerLang}
              hasAudio={card.hasAnswerAudio}
            />
            <WordAudioRow
              cardId={card.id}
              side="prompt"
              word={card.prompt}
              langLabel={promptLang}
              hasAudio={card.hasPromptAudio}
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
