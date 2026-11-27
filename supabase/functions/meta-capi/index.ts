// Deal stage -> Meta Conversions API (CRM / Conversion Leads events).
//
// Called by the DB trigger "91_deal_stage_capi" (pg_net) with { deal_id, stage } whenever a deal is
// created in, or moved to, one of the mapped stages. The function re-reads the deal from the DB and
// only sends when the deal really is in that stage, and each (deal, stage, contact) event id goes out
// once (capi_events), so a forged call cannot invent conversions. No JWT needed (verify_jwt = false).
//
//   call-booked   -> Schedule
//   proposal-sent -> QualifiedLead (custom)
//   won           -> Purchase (value = deal amount, USD)
//
// Instant-form leads carry lead_id (Meta leadgen id); web leads carry hashed email/phone/name plus
// the stored fbc/fbp. action_source = system_generated, custom_data.event_source = "crm",
// lead_event_source = "Ecom Syndicate CRM".
// Test contacts (@example.com) only send when the request has a test_event_code.
import { supabaseAdmin as db } from "../_shared/supabaseAdmin.ts";
import {
  buildUserData,
  isTestEmail,
  LEAD_EVENT_SOURCE,
  normPhone,
  sendCapi,
} from "../_shared/metaCapi.ts";

const STAGE_EVENTS: Record<string, string> = {
  "call-booked": "Schedule",
  "proposal-sent": "QualifiedLead",
  won: "Purchase",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, message: "Invalid JSON" });
  }
  const dealId = Number(body.deal_id);
  if (!Number.isSafeInteger(dealId) || dealId <= 0)
    return json(400, { ok: false, message: "deal_id required" });
  const testCodeIn =
    typeof body.test_event_code === "string" &&
    /^TEST[A-Za-z0-9]{1,30}$/.test(body.test_event_code)
      ? body.test_event_code
      : null;

  const { data: deal, error } = await db
    .from("deals")
    .select(
      "id, stage, amount, contact_ids, archived_at, updated_at, created_at",
    )
    .eq("id", dealId)
    .single();
  if (error || !deal)
    return json(404, { ok: false, message: "deal not found" });
  const eventName = STAGE_EVENTS[deal.stage as string];
  if (!eventName || deal.archived_at)
    return json(200, {
      ok: true,
      skipped: "stage not mapped",
      stage: deal.stage,
    });

  const ids: number[] = Array.isArray(deal.contact_ids) ? deal.contact_ids : [];
  const results: Record<string, unknown>[] = [];
  for (const cid of ids.slice(0, 5)) {
    const { data: c } = await db
      .from("contacts")
      .select(
        "id, first_name, last_name, email_jsonb, phone_jsonb, meta_lead_id, fbc, fbp",
      )
      .eq("id", cid)
      .single();
    if (!c) continue;
    const email =
      (Array.isArray(c.email_jsonb) ? c.email_jsonb[0]?.email : "") ?? "";
    const phone =
      (Array.isArray(c.phone_jsonb) ? c.phone_jsonb[0]?.number : "") ?? "";
    const test = isTestEmail(email);
    if (test && !testCodeIn) {
      results.push({ contact_id: cid, status: "skipped_test_contact" });
      continue;
    }
    const digits = normPhone(phone);
    const userData = await buildUserData({
      email,
      phone,
      firstName: c.first_name,
      lastName: c.last_name,
      country: digits.length === 11 && digits.startsWith("1") ? "us" : null,
      contactId: c.id,
      leadId: c.meta_lead_id,
      fbc: c.fbc,
      fbp: c.fbp,
    });
    const custom: Record<string, unknown> = {
      event_source: "crm",
      lead_event_source: LEAD_EVENT_SOURCE,
      deal_stage: deal.stage,
    };
    if (eventName === "Purchase") {
      custom.currency = "USD";
      custom.value = Number(deal.amount) > 0 ? Number(deal.amount) : 0;
    }
    const r = await sendCapi(
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: `deal.${deal.id}.${deal.stage}.${c.id}`,
        action_source: "system_generated",
        user_data: userData,
        custom_data: custom,
      },
      {
        contactId: c.id,
        dealId: deal.id,
        testEventCode: test ? testCodeIn : null,
      },
    );
    results.push({ contact_id: cid, event: eventName, ...r });
  }
  return json(200, { ok: true, deal_id: deal.id, stage: deal.stage, results });
});
