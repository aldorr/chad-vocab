const STORAGE_KEY = "family-vocab-photo-scan-job";

export type StoredPhotoScanJob = {
  jobId: string;
  startedAt: number;
};

export function savePhotoScanJob(job: StoredPhotoScanJob) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(job));
  } catch {
    /* private mode / quota */
  }
}

export function loadPhotoScanJob(): StoredPhotoScanJob | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPhotoScanJob;
    if (!parsed?.jobId || !parsed?.startedAt) return null;
    // Expire client-side after 30 minutes
    if (Date.now() - parsed.startedAt > 30 * 60_000) {
      clearPhotoScanJob();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPhotoScanJob() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
