-- Backfill first/last touch for the 5 leads of the Nov 26-27 tests (contacts 57-61)
-- from the Meta CSV pulls (/workspace/ecom-syndicate/leads/*.csv) and the CRM notes.
-- Run ONCE after migration 20261127160000_attribution_capi. Idempotent (plain updates).
begin;
select set_config('esy.attr_override', 'on', true);  -- this transaction only

-- 57 Darrin Smith: Winners instant form, Meta lead l:2182971132330368, 2026-11-26 13:27:44 ET
update public.contacts set
  first_touch = jsonb_build_object('at','2026-11-26T18:27:44Z','channel','meta_instant_form','source','meta-instant-form',
    'meta_lead_id','2182971132330368','campaign_id','120251066891880621','campaign_name','ESY | Quiz Leads | USA | Winners 2-day',
    'adset_id','120251066998270621','adset_name','USA | 25-65 | Broad | Winners | Instant form',
    'ad_id','120251067188660621','ad_name','Main team image | Instant form - Copy 3',
    'form_id','1135165872599515','form_name','ESY Quick Apply | Winners 3-way | No SMS','platform','an','is_organic','false',
    'utm_source','meta','utm_medium','paid','utm_campaign','ESY | Quiz Leads | USA | Winners 2-day',
    'utm_content','120251067188660621','utm_term','120251066998270621','backfilled','2026-11-27 from no-sms-leads-2026-11-27.csv'),
  utm_source='meta', utm_medium='paid', utm_campaign='ESY | Quiz Leads | USA | Winners 2-day',
  utm_content='120251067188660621', utm_term='120251066998270621',
  meta_lead_id='2182971132330368', submitted_at='2026-11-26T18:27:44Z'
where id = 57;
update public.contacts set last_touch = first_touch where id = 57;

-- 58 Thierry Estiverne: first touch = Winners instant form (l:1942299677138863, 2026-11-26 23:49:51 IST).
-- Later touches: Calendly booking 23:50:39 IST (utm meta / meta-ads-embed), quiz submit 02:10:36 IST and
-- 2nd Calendly booking 02:10:59 IST, both utm facebook / social / fb_page_post_welcome (that overwrote the UTMs).
update public.contacts set
  first_touch = jsonb_build_object('at','2026-11-26T21:49:51Z','channel','meta_instant_form','source','meta-instant-form',
    'meta_lead_id','1942299677138863','campaign_id','120251066891880621','campaign_name','ESY | Quiz Leads | USA | Winners 2-day',
    'adset_id','120251066998270621','adset_name','USA | 25-65 | Broad | Winners | Instant form',
    'ad_id','120251067188660621','ad_name','Main team image | Instant form - Copy 3',
    'form_id','1135165872599515','form_name','ESY Quick Apply | Winners 3-way | No SMS','platform','fb','is_organic','false',
    'utm_source','meta','utm_medium','paid','utm_campaign','ESY | Quiz Leads | USA | Winners 2-day',
    'utm_content','120251067188660621','utm_term','120251066998270621','backfilled','2026-11-27 from no-sms-leads-2026-11-27.csv'),
  last_touch = jsonb_build_object('at','2026-11-27T00:10:59Z','channel','calendly','utm_source','facebook','utm_medium','social',
    'utm_campaign','fb_page_post_welcome','event','30 Minute Meeting','backfilled','2026-11-27 from contact note 22'),
  utm_source='meta', utm_medium='paid', utm_campaign='ESY | Quiz Leads | USA | Winners 2-day',
  utm_content='120251067188660621', utm_term='120251066998270621',
  lead_source='meta-instant-form', meta_lead_id='1942299677138863', submitted_at='2026-11-26T21:49:51Z',
  phone_jsonb = case when phone_jsonb = '[]'::jsonb then '[{"type":"Work","number":"+14077287073"}]'::jsonb else phone_jsonb end
where id = 58;

-- 59 De'Andrae Sam, 60 Nilton Cool: quiz via ad "Main team image | Quiz - Copy 3" (utm_content/utm_term = ad/adset id)
update public.contacts c set
  first_touch = jsonb_build_object('at', to_char(c.first_seen at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'channel','website','source','quiz','page','quiz',
    'page_url','https://ernestponz-create.github.io/ecom-syndicate/quiz/',
    'campaign_id','120251066891880621','campaign_name','ESY | Quiz Leads | USA | Winners 2-day',
    'adset_id','120251066892030621','adset_name','USA | 25-65 | Broad | Winners | Quiz',
    'ad_id','120251066891920621','ad_name','Main team image | Quiz - Copy 3',
    'utm_source',c.utm_source,'utm_medium',c.utm_medium,'utm_campaign',c.utm_campaign,'utm_content',c.utm_content,'utm_term',c.utm_term,
    'backfilled','2026-11-27 from CRM utm columns (fbclid was not captured before 2026-11-27)'),
  submitted_at = c.first_seen
where c.id in (59, 60) and c.utm_content = '120251066891920621';
update public.contacts set last_touch = first_touch where id in (59, 60);

-- 61 Dayven Hicks: Volume instant form, Meta lead l:29460688900238078, 2026-11-26 16:42:01 ET, Instagram
update public.contacts set
  first_touch = jsonb_build_object('at','2026-11-26T21:42:01Z','channel','meta_instant_form','source','meta-volume',
    'meta_lead_id','29460688900238078','campaign_id','120251081655110621','campaign_name','ESY | Volume Leads | USA | DRAFT',
    'adset_id','120251081655120621','adset_name','USA | 25-55 | Interests | Volume | Instant form',
    'ad_id','120251081773380621','ad_name','Volume | Free guide',
    'form_id','2244578922774532','form_name','ESY Volume | Free guide','platform','ig','is_organic','false',
    'utm_source','meta','utm_medium','paid','utm_campaign','ESY | Volume Leads | USA | DRAFT',
    'utm_content','120251081773380621','utm_term','120251081655120621','backfilled','2026-11-27 from esy-volume-free-guide-leads-2026-11-27-1400.csv'),
  utm_source='meta', utm_medium='paid', utm_campaign='ESY | Volume Leads | USA | DRAFT',
  utm_content='120251081773380621', utm_term='120251081655120621',
  meta_lead_id='29460688900238078', submitted_at='2026-11-26T21:42:01Z',
  phone_jsonb = '[{"type":"Work","number":"+13478052900"}]'::jsonb
where id = 61;
update public.contacts set last_touch = first_touch where id = 61;

-- Touch log rows (Meta lead ids make later routine pulls of these leads a no-op).
insert into public.lead_touches (contact_id, touch_at, channel, meta_lead_id, attribution)
select id, (first_touch->>'at')::timestamptz, first_touch->>'channel', meta_lead_id, first_touch
from public.contacts where id in (57, 58, 59, 60, 61) and first_touch is not null
on conflict (meta_lead_id) do nothing;
insert into public.lead_touches (contact_id, touch_at, channel, attribution) values
  (58, '2026-11-26T21:50:39Z', 'calendly', '{"utm_source":"meta","utm_medium":"meta-ads-embed","event":"30 Minute Meeting","note_id":20}'),
  (58, '2026-11-27T00:10:36Z', 'website', '{"page":"quiz","utm_source":"facebook","utm_medium":"social","utm_campaign":"fb_page_post_welcome","note_id":21}'),
  (58, '2026-11-27T00:10:59Z', 'calendly', '{"utm_source":"facebook","utm_medium":"social","utm_campaign":"fb_page_post_welcome","event":"30 Minute Meeting","note_id":22}');

-- Any other older contact that has legacy UTMs but no first_touch: freeze them as first touch.
update public.contacts set
  first_touch = jsonb_strip_nulls(jsonb_build_object('at', to_char(first_seen at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'channel','legacy','source',lead_source,'utm_source',utm_source,'utm_medium',utm_medium,'utm_campaign',utm_campaign,
    'utm_content',utm_content,'utm_term',utm_term,'backfilled','2026-11-27 from legacy utm columns'))
where first_touch is null
  and (utm_source is not null or utm_medium is not null or utm_campaign is not null or utm_content is not null or utm_term is not null);

commit;

select contact_id, first_name, ft_channel, ft_at, ft_campaign_name, ft_adset_name, ft_ad_name, ft_form_name, lt_channel, lt_utm_campaign
from public.contact_attribution where contact_id between 57 and 61 order by contact_id;
