import { useGetList, useTranslate } from "ra-core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import type { Contact, ContactNote } from "../types";
import {
  countLeadsWithoutNotes,
  formatNoNotesPercent,
  getLeadMetricBounds,
} from "./leadMetrics";

const LIST_LIMIT = 1000;

const MetricCard = ({
  title,
  value,
  isPending,
}: {
  title: string;
  value: string | number;
  isPending: boolean;
}) => (
  <Card className="gap-2 py-4">
    <CardHeader className="px-4">
      <CardTitle className="text-sm font-medium text-muted-foreground">
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      {isPending ? (
        <Skeleton className="h-9 w-16" />
      ) : (
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
      )}
    </CardContent>
  </Card>
);

export const LeadMetrics = () => {
  const translate = useTranslate();
  const { todayStart, tomorrowStart, weekStart, nextWeekStart } =
    getLeadMetricBounds();

  const {
    data: todayContacts,
    total: todayTotal = 0,
    isPending: todayPending,
  } = useGetList<Contact>("contacts", {
    pagination: { page: 1, perPage: LIST_LIMIT },
    sort: { field: "first_seen", order: "DESC" },
    filter: {
      "first_seen@gte": todayStart.toISOString(),
      "first_seen@lt": tomorrowStart.toISOString(),
    },
  });

  const {
    data: weekContacts,
    total: weekTotal = 0,
    isPending: weekPending,
  } = useGetList<Contact>("contacts", {
    pagination: { page: 1, perPage: LIST_LIMIT },
    sort: { field: "first_seen", order: "DESC" },
    filter: {
      "first_seen@gte": weekStart.toISOString(),
      "first_seen@lt": nextWeekStart.toISOString(),
    },
  });

  const weekIds = (weekContacts ?? []).map((contact) => contact.id);
  const notesEnabled = !weekPending && weekIds.length > 0;

  const { data: weekNotes, isPending: notesPending } = useGetList<ContactNote>(
    "contact_notes",
    {
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
      filter: {
        "contact_id@in": `(${weekIds.join(",")})`,
      },
    },
    { enabled: notesEnabled },
  );

  const isPending =
    todayPending || weekPending || (notesEnabled && notesPending);

  const todayWithoutNotes = countLeadsWithoutNotes(
    todayContacts ?? [],
    weekNotes ?? [],
  );
  const weekWithoutNotes = countLeadsWithoutNotes(
    weekContacts ?? [],
    weekNotes ?? [],
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        title={translate("crm.dashboard.leads_today")}
        value={todayTotal}
        isPending={isPending}
      />
      <MetricCard
        title={translate("crm.dashboard.leads_this_week")}
        value={weekTotal}
        isPending={isPending}
      />
      <MetricCard
        title={translate("crm.dashboard.no_notes_today")}
        value={formatNoNotesPercent(todayWithoutNotes, todayTotal)}
        isPending={isPending}
      />
      <MetricCard
        title={translate("crm.dashboard.no_notes_this_week")}
        value={formatNoNotesPercent(weekWithoutNotes, weekTotal)}
        isPending={isPending}
      />
    </div>
  );
};
