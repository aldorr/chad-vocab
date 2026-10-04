import raw from "../../shared/sample-pairs.json";

type SamplePair = { answer: string; prompt: string };

const SAMPLES = raw as Record<string, SamplePair[]>;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Sample import lines: answer (learning) | prompt (cue). */
export function sampleImportText(answerLang: string, promptLang: string): string {
  const key = `${norm(answerLang)}|${norm(promptLang)}`;
  const found = SAMPLES[key];
  if (found?.length) {
    return found.map((p) => `${p.answer} | ${p.prompt}`).join("\n");
  }
  return [
    `# Replace with ${answerLang} | ${promptLang} pairs (learning language first)`,
    `example_in_${norm(answerLang) || "answer"} | example_in_${norm(promptLang) || "cue"}`,
  ].join("\n");
}
