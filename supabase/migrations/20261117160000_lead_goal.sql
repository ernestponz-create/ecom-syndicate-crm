-- The quiz also asks "What's your main goal?" - store it as a normalized column too.
--   goal: launch | fix_grow | scale | add_ecom
alter table public.contacts add column if not exists goal text;
alter table public.contacts drop constraint if exists contacts_goal_check;
alter table public.contacts add constraint contacts_goal_check
  check (goal is null or goal in ('launch', 'fix_grow', 'scale', 'add_ecom'));

create or replace view public.contacts_summary with (security_invoker = on) as
select
    co.id,
    co.first_name,
    co.last_name,
    co.gender,
    co.title,
    co.background,
    co.avatar,
    co.first_seen,
    co.last_seen,
    co.has_newsletter,
    co.status,
    co.tags,
    co.company_id,
    co.sales_id,
    co.linkedin_url,
    co.email_jsonb,
    co.phone_jsonb,
    (jsonb_path_query_array(co.email_jsonb, '$[*]."email"'))::text as email_fts,
    (jsonb_path_query_array(co.phone_jsonb, '$[*]."number"'))::text as phone_fts,
    c.name as company_name,
    count(distinct t.id) filter (where t.done_date is null) as nb_tasks,
    co.lead_source,
    co.readiness,
    co.situation,
    co.timeline,
    co.goal
from public.contacts co
    left join public.tasks t on co.id = t.contact_id
    left join public.companies c on co.company_id = c.id
group by co.id, c.name;

with latest as (
  select distinct on (contact_id)
    contact_id,
    (regexp_match(text, '- Situation: [^\n]* — goal: ([^\n]*)'))[1] as goal_raw
  from public.contact_notes
  where text like 'Landing page form submission%'
  order by contact_id, date desc
)
update public.contacts c
set goal = case
  when l.goal_raw ilike 'launch my first%' then 'launch'
  when l.goal_raw ilike 'fix and grow%' then 'fix_grow'
  when l.goal_raw ilike 'scale what%' then 'scale'
  when l.goal_raw ilike 'add ecommerce%' then 'add_ecom'
end
from latest l
where l.contact_id = c.id and c.goal is null;
