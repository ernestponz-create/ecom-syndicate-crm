import { endOfYesterday, startOfMonth, startOfWeek, subMonths } from "date-fns";
import {
  CheckSquare,
  Clock,
  Compass,
  Flame,
  Gauge,
  Hourglass,
  Megaphone,
  Target,
  Tag,
  Users,
} from "lucide-react";
import {
  useGetIdentity,
  useGetList,
  useListContext,
  useTranslate,
} from "ra-core";
import { ToggleFilterButton } from "@/components/admin/toggle-filter-button";
import { Badge } from "@/components/ui/badge";

import { FilterCategory } from "../filters/FilterCategory";
import { Status } from "../misc/Status";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { ResponsiveFilters } from "../misc/ResponsiveFilters";
import { useIsMobile } from "@/hooks/use-mobile";
import { ActiveFilterButton } from "../misc/ActiveFilterButton";
import { AccountManagerFilter } from "../sales/AccountManagerInput";
import {
  getQuizSourceLabel,
  isQuizSource,
  leadFieldGroups,
  temperatureValues,
} from "./leadFields";

// Distinct quiz-type lead sources found in the data ('quiz', 'quiz-v2', ...).
const useQuizSources = (): string[] => {
  const { data } = useGetList("contacts", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "lead_source", order: "ASC" },
    filter: { "lead_source@ilike": "quiz*" },
  });
  const set = new Set<string>();
  (data ?? []).forEach((c: any) => {
    if (isQuizSource(c.lead_source)) set.add(c.lead_source);
  });
  return Array.from(set).sort();
};

const leadFieldIcons = {
  lead_source: <Megaphone />,
  readiness: <Gauge />,
  situation: <Compass />,
  timeline: <Hourglass />,
  goal: <Target />,
};

const useTemperatureStatuses = () => {
  const { noteStatuses } = useConfigurationContext();
  return noteStatuses.filter((s) => temperatureValues.includes(s.value));
};

export const ContactListFilter = () => {
  const noteStatuses = useTemperatureStatuses();
  const quizSources = useQuizSources();
  const isMobile = useIsMobile();
  const { identity } = useGetIdentity();
  const translate = useTranslate();
  const { data } = useGetList("tags", {
    pagination: { page: 1, perPage: 10 },
    sort: { field: "name", order: "ASC" },
  });

  return (
    <ResponsiveFilters
      searchInput={{
        placeholder: translate("resources.contacts.filters.search"),
      }}
    >
      {quizSources.length > 0 && (
        <FilterCategory
          label="resources.contacts.filters.lead_source"
          icon={leadFieldIcons.lead_source}
        >
          {quizSources.map((source) => (
            <ToggleFilterButton
              key={source}
              className="w-auto md:w-full justify-between h-10 md:h-8"
              label={getQuizSourceLabel(source)}
              value={{ lead_source: source }}
              size={isMobile ? "lg" : undefined}
            />
          ))}
        </FilterCategory>
      )}

      {leadFieldGroups.map((group) => (
        <FilterCategory
          key={group.key}
          label={`resources.contacts.filters.${group.key}`}
          icon={leadFieldIcons[group.key]}
        >
          {group.choices.map((choice) => (
            <ToggleFilterButton
              key={choice.id}
              className="w-auto md:w-full justify-between h-10 md:h-8"
              label={choice.name}
              value={{ [group.key]: choice.id }}
              size={isMobile ? "lg" : undefined}
            />
          ))}
        </FilterCategory>
      ))}

      <FilterCategory
        label="resources.contacts.filters.temperature"
        icon={<Flame />}
      >
        {noteStatuses.map((status) => (
          <ToggleFilterButton
            key={status.value}
            className="w-auto md:w-full justify-between h-10 md:h-8"
            label={
              <span>
                {status.label} <Status status={status.value} />
              </span>
            }
            value={{ status: status.value }}
            size={isMobile ? "lg" : undefined}
          />
        ))}
      </FilterCategory>

      <FilterCategory
        label="resources.contacts.fields.last_seen"
        icon={<Clock />}
      >
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.today"
          value={{
            "last_seen@gte": endOfYesterday().toISOString(),
            "last_seen@lte": undefined,
          }}
          size={isMobile ? "lg" : undefined}
        />
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.this_week"
          value={{
            "last_seen@gte": startOfWeek(new Date()).toISOString(),
            "last_seen@lte": undefined,
          }}
          size={isMobile ? "lg" : undefined}
        />
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.before_this_week"
          value={{
            "last_seen@gte": undefined,
            "last_seen@lte": startOfWeek(new Date()).toISOString(),
          }}
          size={isMobile ? "lg" : undefined}
        />
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.before_this_month"
          value={{
            "last_seen@gte": undefined,
            "last_seen@lte": startOfMonth(new Date()).toISOString(),
          }}
          size={isMobile ? "lg" : undefined}
        />
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.before_last_month"
          value={{
            "last_seen@gte": undefined,
            "last_seen@lte": subMonths(
              startOfMonth(new Date()),
              1,
            ).toISOString(),
          }}
          size={isMobile ? "lg" : undefined}
        />
      </FilterCategory>

      <FilterCategory label="resources.contacts.filters.tags" icon={<Tag />}>
        {data &&
          data.map((record) => (
            <ToggleFilterButton
              className="w-auto md:w-full justify-between h-10 md:h-8"
              key={record.id}
              label={
                <Badge
                  variant="secondary"
                  className="text-black text-sm md:text-xs font-normal cursor-pointer"
                  style={{
                    backgroundColor: record?.color,
                  }}
                >
                  {record?.name}
                </Badge>
              }
              value={{ "tags@cs": `{${record.id}}` }}
              size={isMobile ? "lg" : undefined}
            />
          ))}
      </FilterCategory>

      <FilterCategory
        icon={<CheckSquare />}
        label="resources.contacts.filters.tasks"
      >
        <ToggleFilterButton
          className="w-full justify-between h-10 md:h-8"
          label="resources.tasks.filters.with_pending"
          value={{ "nb_tasks@gt": 0 }}
          size={isMobile ? "lg" : undefined}
        />
      </FilterCategory>

      <FilterCategory
        icon={<Users />}
        label="resources.contacts.fields.sales_id"
      >
        <ToggleFilterButton
          className="w-auto md:w-full max-w-full justify-between h-10 md:h-8"
          label="crm.common.me"
          value={{ sales_id: identity?.id }}
          size={isMobile ? "lg" : undefined}
        />
        <AccountManagerFilter
          className="w-auto md:w-full max-w-full justify-between h-10 md:h-8"
          size={isMobile ? "lg" : undefined}
        />
      </FilterCategory>
    </ResponsiveFilters>
  );
};

export const ContactListFilterSummary = () => {
  const noteStatuses = useTemperatureStatuses();
  const quizSources = useQuizSources();
  const { identity } = useGetIdentity();
  const { data } = useGetList("tags", {
    pagination: { page: 1, perPage: 10 },
    sort: { field: "name", order: "ASC" },
  });
  const { filterValues } = useListContext();
  const hasFilters = !!Object.entries(filterValues || {}).filter(
    ([key]) => key !== "q",
  ).length;

  if (!hasFilters) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-start mb-4 gap-1">
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.today"
        value={{
          "last_seen@gte": endOfYesterday().toISOString(),
          "last_seen@lte": undefined,
        }}
      />
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.this_week"
        value={{
          "last_seen@gte": startOfWeek(new Date()).toISOString(),
          "last_seen@lte": undefined,
        }}
      />
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.before_this_week"
        value={{
          "last_seen@gte": undefined,
          "last_seen@lte": startOfWeek(new Date()).toISOString(),
        }}
      />
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.before_this_month"
        value={{
          "last_seen@gte": undefined,
          "last_seen@lte": startOfMonth(new Date()).toISOString(),
        }}
      />
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.before_last_month"
        value={{
          "last_seen@gte": undefined,
          "last_seen@lte": subMonths(startOfMonth(new Date()), 1).toISOString(),
        }}
      />

      {quizSources.map((source) => (
        <ActiveFilterButton
          key={`lead_source-${source}`}
          className="w-auto justify-between h-8"
          label={getQuizSourceLabel(source)}
          value={{ lead_source: source }}
        />
      ))}

      {leadFieldGroups.flatMap((group) =>
        group.choices.map((choice) => (
          <ActiveFilterButton
            key={`${group.key}-${choice.id}`}
            className="w-auto justify-between h-8"
            label={choice.name}
            value={{ [group.key]: choice.id }}
          />
        )),
      )}

      {noteStatuses.map((status) => (
        <ActiveFilterButton
          key={status.value}
          className="w-auto justify-between h-8"
          label={
            <span>
              {status.label} <Status status={status.value} />
            </span>
          }
          value={{ status: status.value }}
        />
      ))}

      {data &&
        data.map((record) => (
          <ActiveFilterButton
            className="w-auto justify-between h-8"
            key={record.id}
            label={
              <Badge
                variant="secondary"
                className="text-black text-sm md:text-xs font-normal cursor-pointer"
                style={{
                  backgroundColor: record?.color,
                }}
              >
                {record?.name}
              </Badge>
            }
            value={{ "tags@cs": `{${record.id}}` }}
          />
        ))}

      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.tasks.filters.with_pending"
        value={{ "nb_tasks@gt": 0 }}
      />

      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.managed_by_me"
        value={{ sales_id: identity?.id }}
      />
    </div>
  );
};
