export type User = {
  id: string;
  username: string;
  pointsTotal: number;
  promptLang: string;
  answerLang: string;
  createdAt: number;
};

export type AudioSide = "answer" | "prompt";

export type Card = {
  id: string;
  answer: string;
  prompt: string;
  hasAnswerAudio: boolean;
  hasPromptAudio: boolean;
  status: "new" | "practice" | "learned";
  streak: number;
  seen: number;
  updatedAt: number;
  createdAt: number;
};

export type Progress = {
  total: number;
  learned: number;
  practice: number;
  new: number;
  unlearned: number;
  pointsTotal?: number;
};

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || res.statusText || "Request failed"
    );
  }
  return data as T;
}

export const api = {
  health: () =>
    request<{
      ok: boolean;
      scriberr: boolean;
      lmStudio: boolean;
      inviteRequired: boolean;
    }>("/health"),
  me: () => request<{ user: User }>("/auth/me"),
  register: (body: {
    username: string;
    password: string;
    inviteCode?: string;
    promptLang?: string;
    answerLang?: string;
  }) =>
    request<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { username: string; password: string }) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  updateSettings: (body: { promptLang: string; answerLang: string }) =>
    request<{ user: User }>("/auth/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listCards: () => request<{ cards: Card[] }>("/cards"),
  importCards: (text: string) =>
    request<{ added: number; skipped: number }>("/cards/import", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  deleteCard: (id: string) =>
    request<{ ok: boolean }>(`/cards/${id}`, { method: "DELETE" }),
  uploadAudio: async (id: string, side: AudioSide, blob: Blob) => {
    const form = new FormData();
    form.append("audio", blob, `${side}.webm`);
    return request<{
      ok: boolean;
      hasAnswerAudio: boolean;
      hasPromptAudio: boolean;
    }>(`/cards/${id}/audio/${side}`, {
      method: "POST",
      body: form,
    });
  },
  deleteAudio: (id: string, side: AudioSide) =>
    request<{ ok: boolean }>(`/cards/${id}/audio/${side}`, {
      method: "DELETE",
    }),
  progress: () =>
    request<Progress & { pointsTotal: number }>("/cards/stats/progress"),
  nextCard: (last?: string | null) =>
    request<{
      card: {
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
      } | null;
      progress: Progress;
      allLearned?: boolean;
      langs: { promptLang: string; answerLang: string };
    }>(`/practice/next${last ? `?last=${encodeURIComponent(last)}` : ""}`),
  answer: (body: {
    cardId: string;
    answer: string;
    source: "type" | "speak";
    direction: "forward" | "reverse";
  }) =>
    request<{
      correct: boolean;
      inconclusive?: boolean;
      reason: string;
      method: string;
      expected: string;
      becameLearned: boolean;
      streak: number;
      status: string;
      pointsAwarded: number;
      user: User;
      progress: Progress;
    }>("/practice/answer", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  speakAnswer: async (
    cardId: string,
    blob: Blob,
    options?: { signal?: AbortSignal; direction?: "forward" | "reverse" }
  ) => {
    const form = new FormData();
    form.append("cardId", cardId);
    form.append("audio", blob, "answer.webm");
    form.append("direction", options?.direction ?? "forward");
    return request<{
      transcript: string;
      correct: boolean;
      inconclusive?: boolean;
      reason: string;
      method: string;
      expected: string;
      becameLearned: boolean;
      streak: number;
      status: string;
      pointsAwarded: number;
      user: User;
      progress: Progress;
    }>("/practice/speak", {
      method: "POST",
      body: form,
      signal: options?.signal,
    });
  },
};
