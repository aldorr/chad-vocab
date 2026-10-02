/** Sample import lines: answer (learning) | prompt (cue). */
const SAMPLES: Record<string, string> = {
  "spanish|german":
    "hola | hallo\ngracias | danke\npor favor | bitte\nagua | Wasser\namigo | Freund",
  "spanish|english":
    "hola | hello\ngracias | thank you\npor favor | please\nagua | water\namigo | friend",
  "french|english":
    "bonjour | hello\nmerci | thank you\ns'il vous plaît | please\neau | water\nami | friend",
  "french|german":
    "bonjour | hallo\nmerci | danke\ns'il vous plaît | bitte\neau | Wasser\nami | Freund",
  "german|english":
    "hallo | hello\ndanke | thank you\nbitte | please\nWasser | water\nFreund | friend",
  "english|german":
    "hello | hallo\nthank you | danke\nplease | bitte\nwater | Wasser\nfriend | Freund",
  "english|spanish":
    "hello | hola\nthank you | gracias\nplease | por favor\nwater | agua\nfriend | amigo",
  "italian|english":
    "ciao | hello\ngrazie | thank you\nper favore | please\nacqua | water\namico | friend",
  "italian|german":
    "ciao | hallo\ngrazie | danke\nper favore | bitte\nacqua | Wasser\namico | Freund",
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function sampleImportText(answerLang: string, promptLang: string): string {
  const key = `${norm(answerLang)}|${norm(promptLang)}`;
  const found = SAMPLES[key];
  if (found) return found;
  return [
    `# Replace with ${answerLang} | ${promptLang} pairs (learning language first)`,
    `example_in_${norm(answerLang) || "answer"} | example_in_${norm(promptLang) || "cue"}`,
  ].join("\n");
}
