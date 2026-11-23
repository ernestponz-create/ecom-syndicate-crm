-- Web Push notifications for new leads.
-- 1. push_subscriptions: one row per browser/device that turned notifications on.
-- 2. AFTER INSERT statement trigger on contacts -> pg_net POST to the
--    push-new-lead Edge Function. Fully wrapped in an exception handler so a
--    push problem can never block a contact insert.
-- The shared secret lives in Supabase Vault under the name 'push_webhook_secret'
-- (created out of band, never committed).

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions select own" on public.push_subscriptions;
create policy "push_subscriptions select own" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "push_subscriptions insert own" on public.push_subscriptions;
create policy "push_subscriptions insert own" on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "push_subscriptions update own" on public.push_subscriptions;
create policy "push_subscriptions update own" on public.push_subscriptions
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "push_subscriptions delete own" on public.push_subscriptions;
create policy "push_subscriptions delete own" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create or replace function public.notify_new_leads_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_count int;
  v_leads jsonb;
begin
  begin
    select count(*) into v_count from new_rows;
    if v_count = 0 then
      return null;
    end if;
    select coalesce(jsonb_agg(l), '[]'::jsonb) into v_leads from (
      select id, first_name, last_name, email_jsonb, phone_jsonb
      from new_rows order by id limit 5
    ) l;
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
    if v_secret is null then
      return null;
    end if;
    perform net.http_post(
      url := 'https://jgujrubjdittbgjwzhwn.supabase.co/functions/v1/push-new-lead',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', v_secret
      ),
      body := jsonb_build_object('count', v_count, 'leads', v_leads),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'notify_new_leads_push failed: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notify_new_leads_push() from public, anon, authenticated;

drop trigger if exists "90_push_new_leads" on public.contacts;
create trigger "90_push_new_leads"
  after insert on public.contacts
  referencing new table as new_rows
  for each statement execute function public.notify_new_leads_push();
