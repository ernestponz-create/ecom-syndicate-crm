import {
  countLeadsWithoutNotes,
  formatNoNotesPercent,
  getLeadMetricBounds,
  isInRange,
} from "./leadMetrics";

describe("getLeadMetricBounds", () => {
  it("uses local midnight and starts the week on Sunday", () => {
    // Wednesday Nov 25, 2026, mid-afternoon local time
    const now = new Date(2026, 10, 25, 15, 30, 0);
    const { todayStart, tomorrowStart, weekStart, nextWeekStart } =
      getLeadMetricBounds(now);

    expect(weekStart.getDay()).toBe(0);
    expect(weekStart.getFullYear()).toBe(2026);
    expect(weekStart.getMonth()).toBe(10);
    expect(weekStart.getDate()).toBe(22);
    expect(weekStart.getHours()).toBe(0);
    expect(weekStart.getMinutes()).toBe(0);

    expect(todayStart.getDate()).toBe(25);
    expect(todayStart.getHours()).toBe(0);
    expect(tomorrowStart.getDate()).toBe(26);
    expect(tomorrowStart.getHours()).toBe(0);

    expect(nextWeekStart.getDay()).toBe(0);
    expect(nextWeekStart.getDate()).toBe(29);
  });

  it("keeps Sunday as the start of its own week", () => {
    const sunday = new Date(2026, 10, 22, 0, 5, 0);
    const { weekStart, todayStart } = getLeadMetricBounds(sunday);
    expect(weekStart.getTime()).toBe(todayStart.getTime());
    expect(weekStart.getDate()).toBe(22);
  });

  it("places Saturday in the week that started the previous Sunday", () => {
    const saturday = new Date(2026, 10, 28, 23, 59, 0);
    const { weekStart, nextWeekStart, todayStart, tomorrowStart } =
      getLeadMetricBounds(saturday);
    expect(weekStart.getDate()).toBe(22);
    expect(nextWeekStart.getDate()).toBe(29);
    expect(todayStart.getDate()).toBe(28);
    expect(tomorrowStart.getDate()).toBe(29);
  });
});

describe("isInRange", () => {
  it("includes the start and excludes the end", () => {
    const start = new Date(2026, 10, 24, 0, 0, 0);
    const end = new Date(2026, 10, 25, 0, 0, 0);
    expect(isInRange(start.toISOString(), start, end)).toBe(true);
    expect(isInRange(end.toISOString(), start, end)).toBe(false);
  });
});

describe("countLeadsWithoutNotes", () => {
  it("counts contacts that have no matching note", () => {
    const contacts = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const notes = [{ contact_id: 1 }, { contact_id: 1 }, { contact_id: 3 }];
    expect(countLeadsWithoutNotes(contacts, notes)).toBe(1);
  });

  it("treats numeric and string ids as the same contact", () => {
    expect(countLeadsWithoutNotes([{ id: 7 }], [{ contact_id: "7" }])).toBe(0);
  });
});

describe("formatNoNotesPercent", () => {
  it("returns a dash when there are no leads", () => {
    expect(formatNoNotesPercent(0, 0)).toBe("—");
  });

  it("rounds the share of leads with no notes", () => {
    expect(formatNoNotesPercent(0, 15)).toBe("0%");
    expect(formatNoNotesPercent(15, 15)).toBe("100%");
    expect(formatNoNotesPercent(1, 3)).toBe("33%");
  });
});
