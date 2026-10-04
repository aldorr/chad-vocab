import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Progress, type User } from "../api";
import { useAuth } from "../auth";
import { CelebrationBurst } from "../CelebrationBurst";
import { DeckSwitcher } from "../DeckSwitcher";
import { flagForLang, langBadge } from "../langFlags";
import {
  detectMicBlock,
  explainMicBlock,
  micErrorToReason,
  pickRecorderMimeType,
  type MicBlockReason,
} from "../mic";
import { useToast } from "../Toast";

type Props = {
  onNavigate: (tab: "deck" | "practice" | "progress") => void;
  onLightMode: () => void;
  onLogout: () => void;
  scriberr: boolean;
  lmStudio: boolean;
};

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

/** One blank per letter/digit; spaces stay as gaps. */
function blankifyCue(text: string): string {
  return [...text]
    .map((ch) => {
      if (/\s/.test(ch)) return " ";
      if (/[0-9\p{L}]/u.test(ch)) return "_";
      return ch;
    })
    .join(" ");
}

export function PracticePage({
  onNavigate,
  onLightMode,
  onLogout,
  scriberr,
  lmStudio,
}: Props) {
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
  const [peekingCue, setPeekingCue] = useState(false);
  const [forceRevealCue, setForceRevealCue] = useState(false);
  const [speakCooldownUntil, setSpeakCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [winMoment, setWinMoment] = useState<WinMoment | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [micBlock, setMicBlock] = useState<MicBlockReason | null>(() =>
    detectMicBlock()
  );
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastId = useRef<string | null>(null);
  const transcribeTimer = useRef<number | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playTimerRef = useRef<number | null>(null);
  const loadGenRef = useRef(0);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const stopAudio = useCallback(() => {
    if (playTimerRef.current != null) {
      window.clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
    const current = audioRef.current;
    if (current) {
      current.pause();
      current.removeAttribute("src");
      current.load();
      audioRef.current = null;
    }
  }, []);

  const playSide = useCallback(
    (id: string, side: "answer" | "prompt") => {
      stopAudio();
      const a = new Audio(`/api/cards/${id}/audio/${side}?t=${Date.now()}`);
      audioRef.current = a;
      void a.play().catch(() => undefined);
    },
    [stopAudio]
  );

  const scheduleCuePlay = useCallback(
    (id: string, side: "answer" | "prompt", gen: number) => {
      if (playTimerRef.current != null) {
        window.clearTimeout(playTimerRef.current);
      }
      playTimerRef.current = window.setTimeout(() => {
        playTimerRef.current = null;
        if (loadGenRef.current !== gen) return;
        playSide(id, side);
      }, 200);
    },
    [playSide]
  );

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
    const gen = ++loadGenRef.current;
    stopAudio();
    setBusy(true);
    setFeedback(null);
    setCorrect(null);
    setAnswer("");
    setWinMoment(null);
    setTranscribing(false);
    setTranscribeLabel("");
    try {
      const res = await api.nextCard(lastId.current);
      if (gen !== loadGenRef.current) return;
      let next = res.card;
      if (next) {
        next = await ensureCardAudio(next);
      }
      if (gen !== loadGenRef.current) return;
      setCard(next);
      setProgress(res.progress);
      setAllLearned(Boolean(res.allLearned));
      if (next) {
        lastId.current = next.id;
        const cueHasAudio =
          next.cueAudioSide === "prompt"
            ? next.hasPromptAudio
            : next.hasAnswerAudio;
        setPeekingCue(false);
        setForceRevealCue(false);
        if (cueHasAudio) {
          scheduleCuePlay(next.id, next.cueAudioSide, gen);
        }
      }
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      toastRef.current.error(
        err instanceof Error ? err.message : "Failed to load card"
      );
    } finally {
      if (gen === loadGenRef.current) setBusy(false);
    }
  }, [ensureCardAudio, scheduleCuePlay, stopAudio]);

  // Mount only — avoid re-running when toast identity changes (was causing card loops)
  useEffect(() => {
    void loadNext();
    return () => {
      loadGenRef.current += 1;
      stopAudio();
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
      setForceRevealCue(true);
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
      setForceRevealCue(true);
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
    const blocked = detectMicBlock();
    if (blocked) {
      setMicBlock(blocked);
      toastRef.current.error(explainMicBlock(blocked));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMimeType();
      const rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || mimeType || "audio/webm",
        });
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
      setMicBlock(null);
      setRecording(true);
      rec.start();
    } catch (err) {
      const reason = micErrorToReason(err);
      setMicBlock(reason);
      toastRef.current.error(explainMicBlock(reason));
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
  const micUnavailable =
    micBlock === "insecure" || micBlock === "unsupported";
  const speakDisabled =
    busy || recording || now < speakCooldownUntil || micUnavailable;
  const cooldownLeft = Math.max(0, Math.ceil((speakCooldownUntil - now) / 1000));
  const micHint = micBlock ? explainMicBlock(micBlock) : null;
  const cueHasAudio = Boolean(
    card &&
      (card.cueAudioSide === "prompt"
        ? card.hasPromptAudio
        : card.hasAnswerAudio)
  );

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  function goTab(next: "deck" | "practice" | "progress") {
    setMenuOpen(false);
    onNavigate(next);
  }

  return (
    <div className="page practice practice--focus">
      <button
        type="button"
        className="focus-burger"
        aria-label="Open menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(true)}
      >
        <span className="focus-burger-bars" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </button>

      {menuOpen && (
        <div
          className="focus-scrim"
          onClick={() => setMenuOpen(false)}
          role="presentation"
        >
          <aside
            className="focus-panel"
            role="dialog"
            aria-label="Practice menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="focus-panel-head">
              <div className="brand">
                <span className="brand-mark">FV</span>
                <div>
                  <strong>Chad Vocab</strong>
                  <small>
                    {user
                      ? `${flagForLang(user.answerLang)} ${user.answerLang} ← ${flagForLang(user.promptLang)} ${user.promptLang} · @${user.username}`
                      : "Practice"}
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="btn ghost focus-close"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="focus-nav">
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
                  className={id === "practice" ? "nav active" : "nav"}
                  onClick={() => goTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {progress && (
              <p className="progress-line focus-progress">
                {progress.learned}/{progress.total} learned ·{" "}
                {progress.unlearned} left
                {user ? ` · ${user.pointsTotal} pts` : ""}
              </p>
            )}

            {allLearned && progress && progress.total > 0 && (
              <p className="celebrate">
                All cards learned — occasional review mode.
              </p>
            )}

            <DeckSwitcher
              onDeckChange={() => {
                setMenuOpen(false);
                void loadNext();
              }}
            />

            <div className="focus-panel-end">
              <span className="pts">{user?.pointsTotal ?? 0} pts</span>
              <span
                className={scriberr ? "dot ok" : "dot warn"}
                title="Scriberr"
              />
              <span
                className={lmStudio ? "dot ok" : "dot warn"}
                title="LM Studio"
              />
              <button type="button" className="btn ghost" onClick={onLightMode}>
                Light mode
              </button>
              <button type="button" className="btn ghost" onClick={onLogout}>
                Log out
              </button>
            </div>
          </aside>
        </div>
      )}

      {!card && !busy && (
        <div className="focus-empty">
          <p className="muted">
            Import some vocab on the Deck page first — open the menu to get
            there.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => goTab("deck")}
          >
            Go to Deck
          </button>
        </div>
      )}

      {card && (
        <div
          className={`prompt-stage prompt-stage--focus${winMoment ? " prompt-stage--party" : ""}`}
        >
          <CelebrationBurst active={Boolean(winMoment)} />
          <p className="lang-tag">
            <span className="lang-flag" aria-hidden>
              {flagForLang(cueLang)}
            </span>{" "}
            {cueLang} cue
          </p>
          {cueHasAudio ? (
            <div className="cue-listen">
              <div className="cue-listen-row">
                <p className="prompt-word prompt-listen">Listen</p>
                <button
                  type="button"
                  className="btn ghost cue-play"
                  onClick={() => playSide(card.id, card.cueAudioSide)}
                  aria-label="Play cue"
                  title="Play cue"
                >
                  <span aria-hidden>▶</span>
                </button>
              </div>
              <button
                type="button"
                className={`cue-blanks${peekingCue || forceRevealCue ? " cue-blanks--revealed" : ""}`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setPeekingCue(true);
                }}
                onPointerUp={() => setPeekingCue(false)}
                onPointerCancel={() => setPeekingCue(false)}
                onLostPointerCapture={() => setPeekingCue(false)}
                onContextMenu={(e) => e.preventDefault()}
                aria-label="Hold to reveal written cue"
                title="Hold to reveal"
              >
                <span className="cue-blanks-sizer" aria-hidden>
                  {blankifyCue(card.prompt)}
                </span>
                <span className="cue-blanks-face">
                  {peekingCue || forceRevealCue
                    ? card.prompt
                    : blankifyCue(card.prompt)}
                </span>
              </button>
            </div>
          ) : (
            <p className="prompt-word">{card.prompt}</p>
          )}

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
                      micHint
                        ? micHint
                        : cooldownLeft > 0
                          ? "Voice check resting — try again shortly"
                          : undefined
                    }
                    onClick={() => void startSpeak()}
                  >
                    {micUnavailable
                      ? "Mic unavailable"
                      : cooldownLeft > 0
                        ? `Try again (${cooldownLeft}s)`
                        : `Speak ${flagForLang(replyLang)}`}
                  </button>
                )}
              </div>
              <div className="answer-status" aria-live="polite">
                {transcribing ? (
                  <span className="transcribe-progress">{transcribeLabel}</span>
                ) : micHint ? (
                  <span className="muted">{micHint}</span>
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
              {(card.replyAudioSide === "prompt"
                ? card.hasPromptAudio
                : card.hasAnswerAudio) && (
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
