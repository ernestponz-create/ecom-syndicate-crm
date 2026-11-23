// New-lead Web Push sender.
//
// Called by the "90_push_new_leads" statement trigger on public.contacts (pg_net),
// authenticated with the x-push-secret header (PUSH_WEBHOOK_SECRET function secret,
// same value as the Vault secret 'push_webhook_secret').
// Body: { count: number, leads: [{ id, first_name, last_name, email_jsonb, phone_jsonb }] }
// Optional test body: { test: true, subscriptions: [{endpoint, keys:{p256dh, auth}}], ... }
// sends only to the given subscriptions instead of the push_subscriptions table.
//
// Sends to every row in push_subscriptions and deletes subscriptions the push
// service reports as gone (404 / 410).
import webpush from "npm:web-push@3.6.7";
import { supabaseAdmin as db } from "../_shared/supabaseAdmin.ts";

const SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@theecomsyndicate.com";
const CRM_BASE_URL = (
  Deno.env.get("PUSH_CRM_URL") ??
  "https://ernestponz-create.github.io/ecom-syndicate-crm/"
).replace(/\/?$/, "/");

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

type Lead = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email_jsonb?: { email?: string }[] | null;
  phone_jsonb?: { number?: string }[] | null;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

const leadName = (l: Lead) =>
  [l.first_name, l.last_name].filter(Boolean).join(" ").trim() || "Unknown";

const leadContact = (l: Lead) =>
  [l.phone_jsonb?.[0]?.number, l.email_jsonb?.[0]?.email]
    .filter(Boolean)
    .join(" · ");

const buildPayload = (count: number, leads: Lead[]) => {
  if (count <= 1 && leads[0]) {
    const l = leads[0];
    return {
      title: `New lead: ${leadName(l)}`,
      body: leadContact(l) || "Open the CRM to see details",
      url: `${CRM_BASE_URL}#/contacts/${l.id}/show`,
      tag: `lead-${l.id}`,
    };
  }
  const names = leads.map(leadName).join(", ");
  return {
    title: `${count} new leads`,
    body: count > leads.length ? `${names}, …` : names,
    url: `${CRM_BASE_URL}#/contacts`,
    tag: `leads-${Date.now()}`,
  };
};

type Sub = { id?: number; endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!SECRET || !timingSafeEqual(req.headers.get("x-push-secret") ?? "", SECRET)) {
    return json(401, { error: "unauthorized" });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json(500, { error: "VAPID keys not configured" });
  }

  let body: {
    count?: number;
    leads?: Lead[];
    test?: boolean;
    subscriptions?: { endpoint: string; keys: { p256dh: string; auth: string } }[];
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }
  const leads = Array.isArray(body.leads) ? body.leads : [];
  const count = Number(body.count ?? leads.length);
  if (!leads.length) return json(200, { sent: 0, reason: "no leads" });

  let subs: Sub[];
  if (body.test) {
    subs = (body.subscriptions ?? []).map((s) => ({
      endpoint: s.endpoint,
      p256dh: s.keys.p256dh,
      auth: s.keys.auth,
    }));
  } else {
    const { data, error } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth");
    if (error) {
      console.error("load subscriptions failed", error.message);
      return json(500, { error: "load subscriptions failed" });
    }
    subs = data ?? [];
  }

  const payload = JSON.stringify(buildPayload(count, leads));
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: "high" },
      ),
    ),
  );

  let sent = 0;
  const expired: string[] = [];
  const failures: { status?: number; host: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
      return;
    }
    const status = (r.reason as { statusCode?: number })?.statusCode;
    let host = "?";
    try {
      host = new URL(subs[i].endpoint).host;
    } catch { /* ignore */ }
    failures.push({ status, host });
    if (status === 404 || status === 410) expired.push(subs[i].endpoint);
  });

  if (expired.length && !body.test) {
    const { error } = await db
      .from("push_subscriptions")
      .delete()
      .in("endpoint", expired);
    if (error) console.error("delete expired failed", error.message);
  }

  console.log(
    JSON.stringify({ count, subscriptions: subs.length, sent, expired: expired.length, failures }),
  );
  return json(200, { subscriptions: subs.length, sent, expired: expired.length, failures });
});
