-- lead_source now holds the (slugged) source_page of the lead-intake submission, so quiz
-- variants ('quiz', 'quiz-v2', 'quiz-b', ...) can be told apart. Calendly bookings do not set it.
alter table public.contacts drop constraint if exists contacts_lead_source_check;
alter table public.contacts add constraint contacts_lead_source_check
  check (lead_source is null or lead_source ~ '^[a-z0-9][a-z0-9_-]{0,39}$');

-- Contacts that were tagged by the first backfill as landing_page / calendly are not quiz leads:
-- clear the calendly ones, keep only values that came from a real source_page.
update public.contacts set lead_source = null where lead_source in ('calendly', 'landing_page');

-- Re-derive from the latest intake note ("- Page: <source_page>").
with latest as (
  select distinct on (contact_id)
    contact_id,
    lower(regexp_replace(trim((regexp_match(text, '- Page: ([^\n]*)'))[1]), '[^a-zA-Z0-9_-]+', '-', 'g')) as page
  from public.contact_notes
  where text like 'Landing page form submission%'
  order by contact_id, date desc
)
update public.contacts c
set lead_source = left(l.page, 40)
from latest l
where l.contact_id = c.id and c.lead_source is null and l.page ~ '^[a-z0-9][a-z0-9_-]*$';
