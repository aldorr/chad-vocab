import { Hono } from "hono";
import { requireAuth, type AuthVars } from "../lib/auth.js";
import {
  generateMissingAudio,
  userCanGenerateSpeech,
} from "../lib/speechAudio.js";

export const speechRoutes = new Hono<{ Variables: AuthVars }>();

speechRoutes.use("*", requireAuth);

speechRoutes.get("/status", async (c) => {
  const user = c.get("user");
  return c.json({
    ready: userCanGenerateSpeech(user),
    hasKey: Boolean(user.elevenlabsKeyEnc),
    hasPromptVoice: Boolean(user.promptVoiceId),
    hasAnswerVoice: Boolean(user.answerVoiceId),
  });
});

speechRoutes.post("/generate", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    cardIds?: string[];
    regenerate?: boolean;
  }>().catch(() => ({} as { cardIds?: string[]; regenerate?: boolean }));

  const result = await generateMissingAudio(user, {
    cardIds: body.cardIds,
    regenerate: Boolean(body.regenerate),
  });
  if ("error" in result) {
    return c.json({ error: result.error }, 400);
  }
  return c.json(result);
});
