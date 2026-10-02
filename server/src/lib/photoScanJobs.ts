import { nanoid } from "nanoid";
import type { VocabPair } from "./lmstudio.js";

export type PhotoScanJob =
  | {
      id: string;
      userId: string;
      status: "pending";
      createdAt: number;
    }
  | {
      id: string;
      userId: string;
      status: "done";
      createdAt: number;
      finishedAt: number;
      pairs: VocabPair[];
      langs: { promptLang: string; answerLang: string };
      deckId: string;
    }
  | {
      id: string;
      userId: string;
      status: "error";
      createdAt: number;
      finishedAt: number;
      error: string;
    };

const jobs = new Map<string, PhotoScanJob>();
const TTL_MS = 30 * 60 * 1000;

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

export function createPhotoScanJob(userId: string): PhotoScanJob {
  prune();
  const job: PhotoScanJob = {
    id: nanoid(),
    userId,
    status: "pending",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getPhotoScanJob(
  id: string,
  userId: string
): PhotoScanJob | null {
  prune();
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return null;
  return job;
}

export function completePhotoScanJob(
  id: string,
  data: {
    pairs: VocabPair[];
    langs: { promptLang: string; answerLang: string };
    deckId: string;
  }
) {
  const prev = jobs.get(id);
  if (!prev) return;
  jobs.set(id, {
    id,
    userId: prev.userId,
    status: "done",
    createdAt: prev.createdAt,
    finishedAt: Date.now(),
    ...data,
  });
}

export function failPhotoScanJob(id: string, error: string) {
  const prev = jobs.get(id);
  if (!prev) return;
  jobs.set(id, {
    id,
    userId: prev.userId,
    status: "error",
    createdAt: prev.createdAt,
    finishedAt: Date.now(),
    error,
  });
}
