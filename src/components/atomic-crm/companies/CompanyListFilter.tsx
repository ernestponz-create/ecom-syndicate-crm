import { Briefcase, Users } from "lucide-react";
import { FilterLiveForm, useGetIdentity, useTranslate } from "ra-core";
import { ToggleFilterButton } from "@/components/admin/toggle-filter-button";
import { SearchInput } from "@/components/admin/search-input";

import { FilterCategory } from "../filters/FilterCategory";
import { AccountManagerFilter } from "../sales/AccountManagerInput";

// Companies here are mostly "<Name> (individual)" records created from leads, so the generic
// Size / Sector filters were replaced with pipeline-oriented ones.
export const CompanyListFilter = () => {
  const { identity } = useGetIdentity();
  const translate = useTranslate();
  return (
    <div className="w-52 min-w-52 flex flex-col gap-8">
      <FilterLiveForm>
        <SearchInput source="q" />
      </FilterLiveForm>

      <FilterCategory
        icon={<Briefcase className="h-4 w-4" />}
        label="resources.companies.filters.pipeline"
      >
        <ToggleFilterButton
          className="w-full justify-between"
          label="With deals"
          value={{ "nb_deals@gt": 0 }}
        />
        <ToggleFilterButton
          className="w-full justify-between"
          label="Without deals"
          value={{ nb_deals: 0 }}
        />
      </FilterCategory>

      <FilterCategory
        icon={<Users className="h-4 w-4" />}
        label="resources.companies.fields.sales_id"
      >
        <ToggleFilterButton
          className="w-full justify-between"
          label={translate("crm.common.me")}
          value={{ sales_id: identity?.id }}
        />
        <AccountManagerFilter className="w-full justify-between" />
      </FilterCategory>
    </div>
  );
};
