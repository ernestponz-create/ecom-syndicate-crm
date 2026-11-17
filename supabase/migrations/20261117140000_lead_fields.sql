-- Lead-relevant structured fields on contacts (used by the CRM filters + contact page).
--   lead_source : quiz | landing_page | calendly
--   readiness   : ready | details_first | not_sure
--   situation   : starting | not_profitable | profitable | other
--   timeline    : asap | 1_3_months | later
-- The raw answers stay in the contact note; these are normalized copies for filtering.

alter table public.contacts
  add column if not exists lead_source text,
  add column if not exists readiness text,
  add column if not exists situation text,
  add column if not exists timeline text;

alter table public.contacts drop constraint if exists contacts_lead_source_check;
alter table public.contacts add constraint contacts_lead_source_check
  check (lead_source is null or lead_source in ('quiz', 'landing_page', 'calendly'));
alter table public.contacts drop constraint if exists contacts_readiness_check;
alter table public.contacts add constraint contacts_readiness_check
  check (readiness is null or readiness in ('ready', 'details_first', 'not_sure'));
alter table public.contacts drop constraint if exists contacts_situation_check;
alter table public.contacts add constraint contacts_situation_check
  check (situation is null or situation in ('starting', 'not_profitable', 'profitable', 'other'));
alter table public.contacts drop constraint if exists contacts_timeline_check;
alter table public.contacts add constraint contacts_timeline_check
  check (timeline is null or timeline in ('asap', '1_3_months', 'later'));

-- Same view as before, new columns appended at the end (contacts_summary feeds the contacts list).
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
    co.timeline
from public.contacts co
    left join public.tasks t on co.id = t.contact_id
    left join public.companies c on co.company_id = c.id
group by co.id, c.name;

-- Backfill from the existing notes (landing page / quiz submissions and Calendly bookings).
with latest_intake as (
  select distinct on (contact_id)
    contact_id,
    text,
    (text ~ '- Page: quiz') as is_quiz,
    (regexp_match(text, 'fund own ad spend: ([^\n]*)'))[1] as readiness_raw,
    split_part((regexp_match(text, '- Situation: ([^\n]*)'))[1], ' — ', 1) as situation_raw,
    (regexp_match(text, '- Timeline: ([^\n]*)'))[1] as timeline_raw
  from public.contact_notes
  where text like 'Landing page form submission%'
  order by contact_id, date desc
),
has_calendly as (
  select distinct contact_id from public.contact_notes where text like 'Calendly call%'
)
update public.contacts c
set
  lead_source = coalesce(
    c.lead_source,
    case
      when li.contact_id is not null and li.is_quiz then 'quiz'
      when li.contact_id is not null then 'landing_page'
      when hc.contact_id is not null then 'calendly'
    end),
  readiness = coalesce(c.readiness, case
    when li.readiness_raw ilike 'yes, i''m ready%' then 'ready'
    when li.readiness_raw ilike 'yes%' then 'details_first'
    when li.readiness_raw ilike 'not%' then 'not_sure'
  end),
  situation = coalesce(c.situation, case
    when li.situation_raw ilike '%not profitable%' then 'not_profitable'
    when li.situation_raw ilike '%don''t have a store%' then 'starting'
    when li.situation_raw ilike '%profitable store%' then 'profitable'
    when li.situation_raw ilike '%different business%' then 'other'
  end),
  timeline = coalesce(c.timeline, case
    when li.timeline_raw ilike 'as soon as%' then 'asap'
    when li.timeline_raw ilike '%1%3 months%' then '1_3_months'
    when li.timeline_raw ilike 'just research%' or li.timeline_raw ilike '%later%' then 'later'
  end)
from (select id from public.contacts) ids
left join latest_intake li on li.contact_id = ids.id
left join has_calendly hc on hc.contact_id = ids.id
where c.id = ids.id;
