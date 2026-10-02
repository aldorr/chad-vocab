/** Map language labels to a recognizable flag emoji. */
const FLAGS: Record<string, string> = {
  english: "🇬🇧",
  spanish: "🇪🇸",
  español: "🇪🇸",
  espanol: "🇪🇸",
  german: "🇩🇪",
  deutsch: "🇩🇪",
  french: "🇫🇷",
  français: "🇫🇷",
  francais: "🇫🇷",
  italian: "🇮🇹",
  portuguese: "🇵🇹",
  dutch: "🇳🇱",
  polish: "🇵🇱",
  swedish: "🇸🇪",
  norwegian: "🇳🇴",
  danish: "🇩🇰",
  finnish: "🇫🇮",
  russian: "🇷🇺",
  japanese: "🇯🇵",
  chinese: "🇨🇳",
  mandarin: "🇨🇳",
  korean: "🇰🇷",
  arabic: "🇸🇦",
  hindi: "🇮🇳",
  turkish: "🇹🇷",
  greek: "🇬🇷",
  hebrew: "🇮🇱",
  czech: "🇨🇿",
  hungarian: "🇭🇺",
  romanian: "🇷🇴",
  ukrainian: "🇺🇦",
  vietnamese: "🇻🇳",
  thai: "🇹🇭",
  indonesian: "🇮🇩",
  catalan: "🇦🇩",
};

export function flagForLang(label: string | undefined | null): string {
  if (!label) return "🏳️";
  const n = label.trim().toLowerCase();
  return FLAGS[n] ?? "🏳️";
}

export function langBadge(label: string | undefined | null): string {
  const name = (label ?? "Language").trim() || "Language";
  return `${flagForLang(name)} ${name}`;
}
