// Meta Conversions API helper (pixel / dataset 3419398771565032).
//
// Secrets (Supabase function secrets, never in code, chat or logs):
//   META_CAPI_TOKEN     required to send; when missing every send is a logged no-op (status skipped_no_token)
//   META_PIXEL_ID       optional, default 3419398771565032
//   META_GRAPH_VERSION  optional, default v23.0
//   META_GRAPH_BASE     optional, local tests only
// The token is sent in the POST body (not the URL) and is never logged or stored.
// Every attempt is written to public.capi_events (event name/id, status, which match keys
// were present - names only, never values - and Meta's response).
import { supabaseAdmin } from "./supabaseAdmin.ts";

export const PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "3419398771565032";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v23.0";
const GRAPH_BASE =
  Deno.env.get("META_GRAPH_BASE") ?? "https://graph.facebook.com"; // override only for local tests
export const LEAD_EVENT_SOURCE = "Ecom Syndicate CRM";

export const capiConfigured = () => Boolean(Deno.env.get("META_CAPI_TOKEN"));

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// E.164 digits without '+'. US 10-digit numbers get the leading 1.
export function normPhone(p: string): string {
  let d = (p || "").replace(/^p:/, "").replace(/\D/g, "");
  if (d.length === 10) d = "1" + d;
  return d.length >= 8 && d.length <= 15 ? d : "";
}
const normName = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

export type PersonKeys = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  country?: string | null; // ISO-2, e.g. "us"
  contactId?: number | null; // -> external_id (hashed "esy-contact-<id>")
  leadId?: string | null; // Meta leadgen id, NOT hashed
  fbc?: string | null;
  fbp?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export async function buildUserData(k: PersonKeys) {
  const ud: Record<string, unknown> = {};
  const email = (k.email || "").trim().toLowerCase();
  if (email) ud.em = [await sha256(email)];
  const ph = normPhone(k.phone || "");
  if (ph) ud.ph = [await sha256(ph)];
  const fn = normName(k.firstName || "");
  if (fn) ud.fn = [await sha256(fn)];
  const ln = normName(k.lastName && k.lastName !== "-" ? k.lastName : "");
  if (ln) ud.ln = [await sha256(ln)];
  const country = (k.country || "").toLowerCase().replace(/[^a-z]/g, "");
  if (country.length === 2) ud.country = [await sha256(country)];
  if (k.contactId)
    ud.external_id = [await sha256(`esy-contact-${k.contactId}`)];
  const lid = (k.leadId || "").replace(/^l:/, "").replace(/\D/g, "");
  if (lid) ud.lead_id = Number.isSafeInteger(Number(lid)) ? Number(lid) : lid;
  if (k.fbc && /^fb\.\d\.\d+\..+/.test(k.fbc)) ud.fbc = k.fbc;
  if (k.fbp && /^fb\.\d\.\d+\.\d+/.test(k.fbp)) ud.fbp = k.fbp;
  if (k.ip) ud.client_ip_address = k.ip;
  if (k.userAgent) ud.client_user_agent = k.userAgent;
  return ud;
}

// fbc from a stored cookie value, or built from fbclid (+ click time).
export function fbcFrom(fbc: string, fbclid: string, clickMs: number): string {
  if (fbc && /^fb\.\d\.\d+\..+/.test(fbc)) return fbc;
  if (fbclid) return `fb.1.${clickMs}.${fbclid}`;
  return "";
}

export type CapiEvent = {
  event_name: string;
  event_time: number; // unix seconds
  event_id: string;
  action_source: "website" | "system_generated";
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
};

export async function sendCapi(
  ev: CapiEvent,
  opts: {
    contactId?: number | null;
    dealId?: number | null;
    testEventCode?: string | null;
  } = {},
): Promise<{ status: string; httpStatus?: number }> {
  const token = Deno.env.get("META_CAPI_TOKEN") ?? "";
  const testCode = opts.testEventCode || null;
  const matchKeys = Object.keys(ev.user_data);
  const log = async (
    status: string,
    httpStatus?: number,
    response?: unknown,
  ) => {
    const { error } = await supabaseAdmin.from("capi_events").insert({
      contact_id: opts.contactId ?? null,
      deal_id: opts.dealId ?? null,
      event_name: ev.event_name,
      event_id: ev.event_id,
      action_source: ev.action_source,
      test_event_code: testCode,
      status,
      http_status: httpStatus ?? null,
      response: response ?? null,
      match_keys: matchKeys,
    });
    if (error) console.error("capi_events insert failed", error.message);
  };

  // Meta rejects events older than 7 days.
  const minTime = Math.floor(Date.now() / 1000) - 7 * 86400 + 60;
  if (ev.event_time < minTime) ev.event_time = Math.floor(Date.now() / 1000);

  if (!token) {
    await log("skipped_no_token");
    return { status: "skipped_no_token" };
  }
  if (
    !matchKeys.some((k) =>
      ["em", "ph", "lead_id", "fbc", "fbp", "external_id"].includes(k),
    )
  ) {
    await log("skipped_no_match_keys");
    return { status: "skipped_no_match_keys" };
  }
  // A live (non-test) event id goes out once.
  if (!testCode) {
    const { count } = await supabaseAdmin
      .from("capi_events")
      .select("id", { count: "exact", head: true })
      .eq("event_id", ev.event_id)
      .eq("status", "sent")
      .is("test_event_code", null);
    if ((count ?? 0) > 0) return { status: "already_sent" };
  }
  try {
    const body: Record<string, unknown> = { data: [ev], access_token: token };
    if (testCode) body.test_event_code = testCode;
    const r = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${PIXEL_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let resp: unknown = null;
    try {
      resp = await r.json();
    } catch {
      resp = null;
    }
    const status = r.ok ? "sent" : "error";
    await log(status, r.status, resp);
    if (!r.ok)
      console.error("capi send failed", r.status, ev.event_name, ev.event_id);
    return { status, httpStatus: r.status };
  } catch (e) {
    await log("error", undefined, { message: String(e).slice(0, 300) });
    return { status: "error" };
  }
}

// Test traffic: only contacts whose email ends in @example.com may carry a test_event_code,
// and such contacts never produce live events.
export const isTestEmail = (email: string) =>
  /@example\.com$/i.test((email || "").trim());
