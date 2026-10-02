import type { FormEvent } from "react";
import { useState } from "react";

type Props = {
  onBack: () => void;
};

type Problem = {
  prompt: string;
  answer: number;
};

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeProblem(age: number): Problem {
  if (age <= 7) {
    const a = randInt(1, 9);
    const b = randInt(1, 9);
    return { prompt: `${a} + ${b}`, answer: a + b };
  }
  if (age <= 10) {
    const a = randInt(2, 12);
    const b = randInt(2, 12);
    return { prompt: `${a} × ${b}`, answer: a * b };
  }
  if (age <= 13) {
    if (Math.random() < 0.5) {
      const a = randInt(12, 48);
      const b = randInt(3, 9);
      return { prompt: `${a} × ${b}`, answer: a * b };
    }
    const b = randInt(3, 12);
    const q = randInt(4, 18);
    const a = b * q;
    return { prompt: `${a} ÷ ${b}`, answer: q };
  }
  if (age <= 17) {
    if (Math.random() < 0.5) {
      const a = randInt(8, 25);
      const b = randInt(3, 9);
      const c = randInt(2, 15);
      return { prompt: `${a} × ${b} + ${c}`, answer: a * b + c };
    }
    const base = randInt(40, 200);
    const pct = [10, 15, 20, 25, 50][randInt(0, 4)];
    return { prompt: `${pct}% of ${base}`, answer: (base * pct) / 100 };
  }
  // 18+: two-step meaner mental math
  if (Math.random() < 0.5) {
    const a = randInt(15, 45);
    const b = randInt(6, 14);
    const c = randInt(11, 39);
    return { prompt: `${a} × ${b} − ${c}`, answer: a * b - c };
  }
  const a = randInt(20, 60);
  const b = randInt(3, 9);
  const c = randInt(4, 12);
  return { prompt: `(${a} + ${b}) × ${c}`, answer: (a + b) * c };
}

export function VocabBrokePage({ onBack }: Props) {
  const [ageInput, setAgeInput] = useState("12");
  const [age, setAge] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [guess, setGuess] = useState("");
  const [result, setResult] = useState<"ok" | "bad" | null>(null);

  function startQuiz(e: FormEvent) {
    e.preventDefault();
    const n = Math.min(99, Math.max(5, Math.round(Number(ageInput)) || 5));
    setAgeInput(String(n));
    setAge(n);
    setProblem(makeProblem(n));
    setGuess("");
    setResult(null);
  }

  function checkAnswer(e: FormEvent) {
    e.preventDefault();
    if (!problem) return;
    const value = Number(guess.trim());
    if (!Number.isFinite(value)) {
      setResult("bad");
      return;
    }
    setResult(value === problem.answer ? "ok" : "bad");
  }

  function anotherProblem() {
    if (age == null) return;
    setProblem(makeProblem(age));
    setGuess("");
    setResult(null);
  }

  return (
    <div className="broke-shell">
      <div className="broke-card">
        <p className="eyebrow">Light mode denied</p>
        <h1>Vocab Broke</h1>
        <p className="lede">
          You asked for light mode. Family Vocab only ships Mocha — so here is
          math instead.
        </p>

        {problem == null ? (
          <form className="stack" onSubmit={startQuiz} style={{ marginTop: "1.25rem" }}>
            <label>
              How old are you?
              <input
                type="number"
                min={5}
                max={99}
                inputMode="numeric"
                value={ageInput}
                onChange={(e) => setAgeInput(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn primary">
              Give me a problem
            </button>
            <button type="button" className="btn ghost" onClick={onBack}>
              Back to Family Vocab
            </button>
          </form>
        ) : (
          <div style={{ marginTop: "1.25rem" }}>
            <p className="muted hint">
              Age {age} · one problem. No light theme will be awarded.
            </p>
            <p className="broke-problem" aria-live="polite">
              {problem.prompt}
            </p>
            <form className="stack" onSubmit={checkAnswer}>
              <label>
                Your answer
                <input
                  type="text"
                  inputMode="decimal"
                  value={guess}
                  onChange={(e) => {
                    setGuess(e.target.value);
                    setResult(null);
                  }}
                  autoFocus
                  required
                />
              </label>
              <button type="submit" className="btn primary">
                Check
              </button>
            </form>
            {result === "ok" && (
              <p className="celebrate" style={{ marginTop: "0.85rem" }}>
                Correct. Still no Latte for you — enjoy the crust.
              </p>
            )}
            {result === "bad" && (
              <p className="error" style={{ marginTop: "0.85rem" }}>
                Not quite. Answer was {problem.answer}. Mocha remains undefeated.
              </p>
            )}
            <div className="broke-actions">
              <button type="button" className="btn" onClick={anotherProblem}>
                Another problem
              </button>
              <button type="button" className="btn primary" onClick={onBack}>
                Back to Family Vocab
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
