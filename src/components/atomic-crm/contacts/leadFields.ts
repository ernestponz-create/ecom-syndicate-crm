// Normalized lead fields stored on contacts (see migration 20261117140000_lead_fields).
// The raw quiz / landing page answers are kept verbatim in the contact note.
export type LeadFieldKey =
  | "lead_source"
  | "readiness"
  | "situation"
  | "timeline";

export type LeadFieldChoice = { id: string; name: string };

// lead_source = slug of the lead-intake source_page. Only quiz-type sources ('quiz',
// 'quiz-v2', 'quiz-b', ...) are offered in the filters; the options are built from the data.
export const isQuizSource = (v?: string | null) => !!v && /^quiz/.test(v);

export const getQuizSourceLabel = (v: string): string => {
  const text = v.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const readinessChoices: LeadFieldChoice[] = [
  { id: "ready", name: "Ready now" },
  { id: "details_first", name: "Wants details first" },
  { id: "not_sure", name: "Not sure yet" },
];

export const situationChoices: LeadFieldChoice[] = [
  { id: "starting", name: "Starting from scratch" },
  { id: "not_profitable", name: "Has store, not profitable" },
  { id: "profitable", name: "Profitable, wants to scale" },
  { id: "other", name: "Different business" },
];

export const timelineChoices: LeadFieldChoice[] = [
  { id: "asap", name: "ASAP" },
  { id: "1_3_months", name: "1–3 months" },
  { id: "later", name: "Later" },
];

export const leadFieldGroups: {
  key: Exclude<LeadFieldKey, "lead_source">;
  label: string;
  choices: LeadFieldChoice[];
}[] = [
  { key: "readiness", label: "Readiness", choices: readinessChoices },
  { key: "situation", label: "Situation", choices: situationChoices },
  { key: "timeline", label: "Timeline", choices: timelineChoices },
];

export const getLeadFieldLabel = (
  key: LeadFieldKey,
  value?: string | null,
): string | undefined => {
  if (!value) return undefined;
  if (key === "lead_source")
    return isQuizSource(value) ? getQuizSourceLabel(value) : undefined;
  return leadFieldGroups
    .find((g) => g.key === key)
    ?.choices.find((c) => c.id === value)?.name;
};

// Temperature = the contact status (hot / warm / cold).
export const temperatureValues = ["hot", "warm", "cold"];
