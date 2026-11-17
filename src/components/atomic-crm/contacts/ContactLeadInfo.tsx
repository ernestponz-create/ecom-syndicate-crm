import { useRecordContext } from "ra-core";

import { Badge } from "@/components/ui/badge";
import type { Contact } from "../types";
import { getLeadFieldLabel, leadFieldGroups } from "./leadFields";

const fieldGroups = [
  { key: "lead_source" as const, label: "Lead source" },
  ...leadFieldGroups,
];

// Ad tracking (UTM) tags saved by lead-intake. Read-only; empty tags are hidden.
const adTrackingFields = [
  { key: "utm_source" as const, label: "Source" },
  { key: "utm_medium" as const, label: "Medium" },
  { key: "utm_campaign" as const, label: "Campaign" },
  { key: "utm_content" as const, label: "Ad" },
  { key: "utm_term" as const, label: "Keyword" },
];

const AdTracking = ({ record }: { record: Contact }) => {
  const rows = adTrackingFields
    .map((field) => ({
      ...field,
      value: record[field.key]?.trim(),
    }))
    .filter((row) => row.value);
  if (!rows.length) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-4 pt-3 border-t">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Ad tracking
      </span>
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex flex-row items-baseline justify-between gap-2"
        >
          <span className="text-muted-foreground">{row.label}</span>
          <span className="text-right break-all">{row.value}</span>
        </div>
      ))}
    </div>
  );
};

// Shows the normalized lead fields (source, readiness, situation, timeline) of a contact,
// followed by the ad tracking block when the lead came with UTM tags.
export const ContactLeadInfo = () => {
  const record = useRecordContext<Contact>();
  if (!record) return null;

  const rows = fieldGroups
    .map((group) => ({
      key: group.key,
      label: group.label,
      value: getLeadFieldLabel(group.key, record[group.key]),
    }))
    .filter((row) => row.value);

  return (
    <>
      {rows.length ? (
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex flex-row items-center justify-between gap-2"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <Badge variant="secondary" className="font-normal">
                {row.value}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">
          No lead details yet.
        </span>
      )}
      <AdTracking record={record} />
    </>
  );
};
