/** Why the browser cannot open the microphone (or null if it can try). */
export type MicBlockReason =
  | "insecure"
  | "unsupported"
  | "denied"
  | "missing"
  | "busy"
  | "unknown";

export function micApiAvailable(): boolean {
  return Boolean(
    typeof navigator !== "undefined" &&
      window.isSecureContext &&
      navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined"
  );
}

/**
 * Browsers only expose getUserMedia in a secure context (HTTPS or localhost).
 * Opening the app via http://192.168.x.x on Android leaves mediaDevices undefined.
 */
export function explainMicBlock(reason: MicBlockReason): string {
  switch (reason) {
    case "insecure":
      return "Voice needs a secure page (HTTPS). On phones, open the app via a Cloudflare Tunnel URL — plain http://LAN-IP blocks the microphone. You can still type answers.";
    case "unsupported":
      return "This browser can’t record audio. Try Chrome, or type your answer instead.";
    case "denied":
      return "Microphone access was blocked. Allow the mic for this site in the browser settings, or type your answer.";
    case "missing":
      return "No microphone found on this device. Type your answer instead.";
    case "busy":
      return "The microphone is in use by another app. Close it and try again, or type your answer.";
    default:
      return "Couldn’t open the microphone. Type your answer instead.";
  }
}

export function detectMicBlock(): MicBlockReason | null {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  if (typeof MediaRecorder === "undefined") return "unsupported";
  return null;
}

export function micErrorToReason(err: unknown): MicBlockReason {
  const name =
    err instanceof DOMException
      ? err.name
      : err instanceof Error
        ? err.name
        : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "missing";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "busy";
  }
  if (name === "SecurityError") {
    return "insecure";
  }
  // Crash when mediaDevices is undefined
  if (
    err instanceof TypeError &&
    /mediaDevices|getUserMedia/i.test(err.message)
  ) {
    return detectMicBlock() ?? "unsupported";
  }
  return "unknown";
}

/** Prefer a mime type Android/Chrome can actually encode. */
export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}
