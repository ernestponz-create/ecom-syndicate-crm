// Normalized lead fields stored on contacts (see migration 20261117140000_lead_fields).
// The raw quiz / landing page answers are kept verbatim in the contact note.
export type LeadFieldKey =
  | "lead_source"
  | "readiness"
  | "situation"
  | "timeline"
  | "goal";

export type LeadFieldChoice = { id: string; name: string };

// lead_source = slug of the lead-intake source_page. Only quiz-type sources ('quiz',
// 'quiz-v2', 'quiz-b', ...) are offered in the filters; the options are built from the data.
export const isQuizSource = (v?: string | null) => !!v && /^quiz/.test(v);

export const getQuizSourceLabel = (v: string): string => {
  const text = v.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Labels use the exact option wording of the quiz questions (quiz.js), so the filters mirror
// what the lead actually clicked. Readiness is the quiz's 4th question ("Ready to work with a
// done-for-you team and fund your own ad spend?").
export const readinessChoices: LeadFieldChoice[] = [
  { id: "ready", name: "Yes, I'm ready" },
  { id: "details_first", name: "Yes, I'd like details first" },
  { id: "not_sure", name: "Not yet" },
];

export const situationChoices: LeadFieldChoice[] = [
  { id: "starting", name: "I don't have a store yet" },
  { id: "not_profitable", name: "I have a store, but it's not profitable yet" },
  { id: "profitable", name: "I have a profitable store" },
  { id: "other", name: "I run a different business" },
];

export const goalChoices: LeadFieldChoice[] = [
  { id: "launch", name: "Launch my first ecommerce store" },
  { id: "fix_grow", name: "Fix and grow my current store" },
  { id: "scale", name: "Scale what's already working" },
  { id: "add_ecom", name: "Add ecommerce to my business" },
];

export const timelineChoices: LeadFieldChoice[] = [
  { id: "asap", name: "As soon as possible" },
  { id: "1_3_months", name: "In 1–3 months" },
  { id: "later", name: "Just researching" },
];

export const leadFieldGroups: {
  key: Exclude<LeadFieldKey, "lead_source">;
  label: string;
  choices: LeadFieldChoice[];
}[] = [
  { key: "readiness", label: "Readiness", choices: readinessChoices },
  { key: "situation", label: "Situation", choices: situationChoices },
  { key: "goal", label: "Main goal", choices: goalChoices },
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
