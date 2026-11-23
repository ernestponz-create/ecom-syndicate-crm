import { addDays, addWeeks, startOfDay, startOfWeek } from "date-fns";
import type { Identifier } from "ra-core";

/** Israel weeks start on Sunday. date-fns defaults to this; be explicit. */
export const WEEK_STARTS_ON = 0 as const;

export type LeadMetricBounds = {
  todayStart: Date;
  tomorrowStart: Date;
  weekStart: Date;
  nextWeekStart: Date;
};

export const getLeadMetricBounds = (now = new Date()): LeadMetricBounds => {
  const todayStart = startOfDay(now);
  const tomorrowStart = startOfDay(addDays(now, 1));
  const weekStart = startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON });
  const nextWeekStart = addWeeks(weekStart, 1);
  return { todayStart, tomorrowStart, weekStart, nextWeekStart };
};

export const isInRange = (isoDate: string, start: Date, end: Date) => {
  const time = new Date(isoDate).getTime();
  return time >= start.getTime() && time < end.getTime();
};

export const countLeadsWithoutNotes = (
  contacts: { id: Identifier }[],
  notes: { contact_id: Identifier }[],
) => {
  const withNotes = new Set(notes.map((note) => String(note.contact_id)));
  return contacts.filter((contact) => !withNotes.has(String(contact.id)))
    .length;
};

/** Dash when there are no leads, so a missing rate is not shown as 0%. */
export const formatNoNotesPercent = (withoutNotes: number, total: number) => {
  if (total === 0) {
    return "—";
  }
  return `${Math.round((withoutNotes / total) * 100)}%`;
};
