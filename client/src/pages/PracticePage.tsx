import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Progress, type User } from "../api";
import { useAuth } from "../auth";
import { CelebrationBurst } from "../CelebrationBurst";
import { flagForLang, langBadge } from "../langFlags";
import { useToast } from "../Toast";

type PracticeCard = {
  id: string;
  prompt: string;
  answer: string;
  direction: "forward" | "reverse";
  hasAnswerAudio: boolean;
  hasPromptAudio: boolean;
  cueAudioSide: "answer" | "prompt";
  replyAudioSide: "answer" | "prompt";
  cueLang: string;
  replyLang: string;
  status: string;
  streak: number;
};

const SPEAK_COOLDOWN_MS = 60_000;

type WinMoment = {
  reason: string;
  pointsAwarded: number;
  becameLearned: boolean;
  answer: string;
  replyLang: string;
};

export function PracticePage() {
  const { setUser, user } = useAuth();
  const toast = useToast();
  const [card, setCard] = useState<PracticeCard | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [allLearned, setAllLearned] = useState(false);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeLabel, setTranscribeLabel] = useState("");
  const [showCueText, setShowCueText] = useState(true);
  const [speakCooldownUntil, setSpeakCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [winMoment, setWinMoment] = useState<WinMoment | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastId = useRef<string | null>(null);
  const transcribeTimer = useRef<number | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const playSide = useCallback((id: string, side: "answer" | "prompt") => {
    const a = new Audio(`/api/cards/${id}/audio/${side}?t=${Date.now()}`);
    void a.play().catch(() => undefined);
  }, []);

  const ensureCardAudio = useCallback(
    async (c: PracticeCard): Promise<PracticeCard> => {
      const needs =
        !c.hasPromptAudio ||
        !c.hasAnswerAudio;
      const ready =
        user?.elevenlabsKeyHint && user.promptVoiceId && user.answerVoiceId;
      if (!needs || !ready) return c;
      try {
        const res = await api.generateAudio({ cardIds: [c.id] });
        const updated = res.cards.find((x) => x.id === c.id);
        if (!updated) return c;
        return {
          ...c,
          hasAnswerAudio: updated.hasAnswerAudio,
          hasPromptAudio: updated.hasPromptAudio,
        };
      } catch {
        return c;
      }
    },
    [user?.elevenlabsKeyHint, user?.promptVoiceId, user?.answerVoiceId]
  );

  const loadNext = useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    setCorrect(null);
    setAnswer("");
    setWinMoment(null);
    setTranscribing(false);
    setTranscribeLabel("");
    try {
      const res = await api.nextCard(lastId.current);
      let next = res.card;
      if (next) {
        next = await ensureCardAudio(next);
      }
      setCard(next);
      setProgress(res.progress);
      setAllLearned(Boolean(res.allLearned));
      if (next) {
        lastId.current = next.id;
        const cueHasAudio =
          next.cueAudioSide === "prompt"
            ? next.hasPromptAudio
            : next.hasAnswerAudio;
        setShowCueText(!cueHasAudio);
        if (cueHasAudio) {
          window.setTimeout(() => playSide(next!.id, next!.cueAudioSide), 150);
        }
      }
    } catch (err) {
      toastRef.current.error(
        err instanceof Error ? err.message : "Failed to load card"
      );
    } finally {
      setBusy(false);
    }
  }, [playSide, ensureCardAudio]);

  // Mount only — avoid re-running when toast identity changes (was causing card loops)
  useEffect(() => {
    void loadNext();
    return () => {
      speakAbortRef.current?.abort();
      if (transcribeTimer.current != null) {
        window.clearInterval(transcribeTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (speakCooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [speakCooldownUntil]);

  function applyUser(u: User) {
    setUser(u);
  }

  async function submitTyped(e: FormEvent) {
    e.preventDefault();
    if (!card || !answer.trim()) return;
    setBusy(true);
    try {
      const res = await api.answer({
        cardId: card.id,
        answer: answer.trim(),
        source: "type",
        direction: card.direction,
      });
      handleGradeResult(res);
    } catch (err) {
      toastRef.current.error(
        err instanceof Error ? err.message : "Failed to grade"
      );
      setBusy(false);
    }
  }

  function handleGradeResult(res: {
    correct: boolean;
    inconclusive?: boolean;
    reason: string;
    method: string;
    expected: string;
    becameLearned: boolean;
    pointsAwarded: number;
    user: User;
    progress: Progress;
  }) {
    applyUser(res.user);
    setProgress(res.progress);
    setTranscribing(false);
    setTranscribeLabel("");

    if (res.inconclusive || res.method === "fallback") {
      setShowCueText(true);
      toastRef.current.error(res.reason);
      setBusy(false);
      return;
    }

    setCorrect(res.correct);
    if (res.correct) {
      const summary = `${res.reason}${res.pointsAwarded ? ` (+${res.pointsAwarded} pts)` : ""}${
        res.becameLearned ? " — marked learned!" : ""
      }`;
      setFeedback(summary);
      setWinMoment({
        reason: res.reason,
        pointsAwarded: res.pointsAwarded,
        becameLearned: res.becameLearned,
        answer: res.expected,
        replyLang: card?.replyLang ?? "answer",
      });
      setBusy(false);
      if (card?.hasAnswerAudio) playSide(card.id, card.replyAudioSide);
      toastRef.current.ok(
        res.becameLearned ? "Card mastered — nice work!" : "Correct!"
      );
    } else {
      const msg = `${res.reason}\nExpected: ${res.expected}`;
      setFeedback(msg);
      setShowCueText(true);
      setBusy(false);
      toastRef.current.error(msg);
      if (card?.hasAnswerAudio) playSide(card.id, card.replyAudioSide);
    }
  }

  function startTranscribeProgress() {
    const started = Date.now();
    setTranscribing(true);
    setTranscribeLabel("Checking answer…");
    if (transcribeTimer.current != null) {
      window.clearInterval(transcribeTimer.current);
    }
    transcribeTimer.current = window.setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      setTranscribeLabel(
        s < 15
          ? `Checking answer… ${s}s`
          : s < 45
            ? `Still checking… ${s}s`
            : `Almost there… ${s}s — thanks for waiting`
      );
    }, 500);
  }

  function stopTranscribeProgress() {
    if (transcribeTimer.current != null) {
      window.clearInterval(transcribeTimer.current);
      transcribeTimer.current = null;
    }
    setTranscribing(false);
    setTranscribeLabel("");
  }

  function cancelTranscription() {
    if (!speakAbortRef.current) return;
    speakAbortRef.current.abort();
  }

  function isAbortError(err: unknown) {
    return (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    );
  }

  async function startSpeak() {
    if (!card || now < speakCooldownUntil) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const abort = new AbortController();
        speakAbortRef.current = abort;
        setBusy(true);
        startTranscribeProgress();
        try {
          const res = await api.speakAnswer(card.id, blob, {
            signal: abort.signal,
            direction: card.direction,
          });
          if (abort.signal.aborted) return;
          stopTranscribeProgress();
          speakAbortRef.current = null;
          setAnswer(res.transcript);
          handleGradeResult(res);
        } catch (err) {
          stopTranscribeProgress();
          speakAbortRef.current = null;
          setBusy(false);
          if (isAbortError(err)) {
            toastRef.current.info(
              "Stopped checking — type your answer or try speaking again."
            );
            return;
          }
          const message =
            err instanceof Error ? err.message : "Couldn’t check that recording";
          toastRef.current.error(message);
          setSpeakCooldownUntil(Date.now() + SPEAK_COOLDOWN_MS);
          setNow(Date.now());
        }
      };
      mediaRef.current = rec;
      setRecording(true);
      rec.start();
    } catch (err) {
      toastRef.current.error(
        err instanceof Error ? err.message : "Microphone permission denied"
      );
    }
  }

  function stopSpeak() {
    mediaRef.current?.stop();
  }

  function goNextWord() {
    void loadNext();
  }

  const cueLang = card?.cueLang ?? user?.promptLang ?? "cue";
  const replyLang = card?.replyLang ?? user?.answerLang ?? "answer";
  const speakDisabled = busy || recording || now < speakCooldownUntil;
  const cooldownLeft = Math.max(0, Math.ceil((speakCooldownUntil - now) / 1000));

  return (
    <div className="page practice">
      <header className="page-head">
        <h1>Practice</h1>
        <p>
          Cards flip both ways — cue and reply languages swap so you practice
          both directions.
        </p>
        {progress && (
          <p className="progress-line">
            {progress.learned}/{progress.total} learned · {progress.unlearned}{" "}
            left
            {user ? ` · ${user.pointsTotal} pts` : ""}
          </p>
        )}
      </header>

      {allLearned && progress && progress.total > 0 && (
        <p className="celebrate">All cards learned — occasional review mode.</p>
      )}

      {!card && !busy && (
        <p className="muted">Import some vocab on the Deck page first.</p>
      )}

      {card && (
        <div
          className={`prompt-stage${winMoment ? " prompt-stage--party" : ""}`}
        >
          <CelebrationBurst active={Boolean(winMoment)} />
          <p className="lang-tag">
            <span className="lang-flag" aria-hidden>
              {flagForLang(cueLang)}
            </span>{" "}
            {cueLang} cue
          </p>
          {showCueText ? (
            <p className="prompt-word">{card.prompt}</p>
          ) : (
            <p className="prompt-word prompt-hidden">Listening…</p>
          )}
          <div className="row-actions" style={{ justifyContent: "center" }}>
            {card.hasPromptAudio && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => playSide(card.id, card.cueAudioSide)}
              >
                Play cue
              </button>
            )}
            {card.hasPromptAudio && !showCueText && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowCueText(true)}
              >
                Show written cue
              </button>
            )}
          </div>

          {winMoment ? (
            <div className="win-panel" role="status" aria-live="polite">
              <p className="win-emoji" aria-hidden>
                {winMoment.becameLearned ? "🏆" : "🎉"}
              </p>
              <p className="win-title">
                {winMoment.becameLearned ? "Card mastered!" : "Correct!"}
              </p>
              <p className="win-answer">
                <span className="lang-flag" aria-hidden>
                  {flagForLang(winMoment.replyLang)}
                </span>{" "}
                {winMoment.answer}
              </p>
              <p className="win-detail">{winMoment.reason}</p>
              {winMoment.pointsAwarded > 0 && (
                <p className="win-points">+{winMoment.pointsAwarded} points</p>
              )}
              <button
                type="button"
                className="btn primary win-next"
                onClick={goNextWord}
              >
                Next word →
              </button>
            </div>
          ) : (
            <form onSubmit={submitTyped} className="answer-form">
              <label>
                Your {langBadge(replyLang)}
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  autoFocus
                  disabled={busy || recording || transcribing}
                  placeholder={`Type in ${replyLang}…`}
                />
              </label>
              <div className="row-actions">
                <button
                  type="submit"
                  className="btn primary"
                  disabled={
                    busy || recording || transcribing || !answer.trim()
                  }
                >
                  Check
                </button>
                {recording ? (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={stopSpeak}
                  >
                    I’m done
                  </button>
                ) : transcribing ? (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={cancelTranscription}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={speakDisabled}
                    title={
                      cooldownLeft > 0
                        ? "Voice check resting — try again shortly"
                        : undefined
                    }
                    onClick={() => void startSpeak()}
                  >
                    {cooldownLeft > 0
                      ? `Try again (${cooldownLeft}s)`
                      : `Speak ${flagForLang(replyLang)}`}
                  </button>
                )}
              </div>
              <div className="answer-status" aria-live="polite">
                {transcribing ? (
                  <span className="transcribe-progress">{transcribeLabel}</span>
                ) : cooldownLeft > 0 ? (
                  <span className="muted">
                    Voice check is taking a short break — type, or try again soon.
                  </span>
                ) : null}
              </div>
            </form>
          )}

          {correct !== null && feedback && !winMoment && (
            <p className={correct ? "ok" : "error"}>{feedback}</p>
          )}
          {correct === false && card && (
            <p className="reveal">
              Answer ({langBadge(replyLang)}): <strong>{card.answer}</strong>
              {card.hasAnswerAudio && (
                <button
                  type="button"
                  className="btn ghost"
                  style={{ marginLeft: "0.5rem" }}
                  onClick={() => playSide(card.id, card.replyAudioSide)}
                >
                  Hear it
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
