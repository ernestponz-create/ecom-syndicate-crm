import { useRecordContext } from "ra-core";

import { Badge } from "@/components/ui/badge";
import type { Contact } from "../types";
import { getLeadFieldLabel, leadFieldGroups } from "./leadFields";

const fieldGroups = [
  { key: "lead_source" as const, label: "Lead source" },
  ...leadFieldGroups,
];

// Shows the normalized lead fields (source, readiness, situation, timeline) of a contact.
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

  if (!rows.length) {
    return (
      <span className="text-muted-foreground text-sm">
        No lead details yet.
      </span>
    );
  }

  return (
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
  );
};
