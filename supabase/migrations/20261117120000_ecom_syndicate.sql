-- The Ecom Syndicate customizations
-- 1. Leads captured by the public "lead-intake" edge function before the first CRM
--    user exists are stored with sales_id = NULL. When the first sales row is created
--    (the admin signs up), adopt every orphan record so nothing is lost.
-- 2. Branding / funnel configuration stored in the configuration singleton.

create or replace function public.adopt_orphan_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contacts set sales_id = new.id where sales_id is null;
  update public.contact_notes set sales_id = new.id where sales_id is null;
  update public.tasks set sales_id = new.id where sales_id is null;
  return new;
end;
$$;

revoke all on function public.adopt_orphan_records() from public, anon, authenticated;

drop trigger if exists adopt_orphan_records_trigger on public.sales;
create trigger adopt_orphan_records_trigger
  after insert on public.sales
  for each row execute function public.adopt_orphan_records();

insert into public.configuration (id, config) values (1, '{}'::jsonb)
on conflict (id) do nothing;

update public.configuration
set config = jsonb_build_object(
  'title', 'The Ecom Syndicate CRM',
  'currency', 'USD',
  'dealStages', jsonb_build_array(
    jsonb_build_object('value', 'new-lead', 'label', 'New lead'),
    jsonb_build_object('value', 'call-booked', 'label', 'Call booked'),
    jsonb_build_object('value', 'call-done', 'label', 'Call done'),
    jsonb_build_object('value', 'proposal-sent', 'label', 'Proposal sent'),
    jsonb_build_object('value', 'won', 'label', 'Won'),
    jsonb_build_object('value', 'lost', 'label', 'Lost')
  ),
  'dealPipelineStatuses', jsonb_build_array('won'),
  'dealCategories', jsonb_build_array(
    jsonb_build_object('value', 'managed-ecommerce-retainer', 'label', 'Managed ecommerce retainer'),
    jsonb_build_object('value', 'other', 'label', 'Other')
  )
)
where id = 1;
