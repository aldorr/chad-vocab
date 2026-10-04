import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SamplePair = { answer: string; prompt: string };

type SampleMap = Record<string, SamplePair[]>;

function loadSamples(): SampleMap {
  const jsonPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../shared/sample-pairs.json"
  );
  return JSON.parse(fs.readFileSync(jsonPath, "utf8")) as SampleMap;
}

const SAMPLES = loadSamples();

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function sampleKey(answerLang: string, promptLang: string): string {
  return `${norm(answerLang)}|${norm(promptLang)}`;
}

export function getSamplePairs(
  answerLang: string,
  promptLang: string
): SamplePair[] {
  return SAMPLES[sampleKey(answerLang, promptLang)] ?? [];
}
