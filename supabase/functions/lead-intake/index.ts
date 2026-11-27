// Public lead capture endpoint for the landing page form.
//
// POST JSON { name, email, phone, situation, readiness, timeline, consent?, source_page?, website? }
//  - website is a honeypot: when filled we pretend success and store nothing.
//  - Creates (or updates) a contact tagged "Landing page / Meta ads", with a note holding the answers
//    and a "Call new lead" task.
//  - Records are assigned to the first sales user if one exists. If nobody signed up yet,
//    sales_id stays NULL and the adopt_orphan_records trigger (see migration) attaches
//    everything to the first user who signs up.
//
// Attribution + Meta CAPI (2026-11-27): see the 'Attribution' block below and _shared/metaCapi.ts.
// Instant-form leads from the Meta CSV pulls may also send the CSV columns (id, created_time, ad_id,
// ad_name, adset_id, adset_name, campaign_id, campaign_name, form_id, form_name, platform, is_organic).
// A repeated Meta lead id is acknowledged with { success, duplicate: true } and nothing is written.
//
// SECURITY TODO: CORS currently allows any origin. Once the GitHub Pages domain is final, set the
// ALLOWED_ORIGINS secret (comma separated, e.g. https://ernestponz-create.github.io) to restrict it.
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  buildUserData,
  fbcFrom,
  isTestEmail,
  LEAD_EVENT_SOURCE,
  normPhone,
  sendCapi,
} from "../_shared/metaCapi.ts";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes("*")
    ? "*"
    : ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsFor(req) },
  });
}

const clean = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, max)
    : "";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TAG_NAME = "Landing page / Meta ads";
const TAG_COLOR = "#e8cb7d";
const QUIZ_TAG_NAME = "Quiz";
const QUIZ_TAG_COLOR = "#b4a7d6";
const OPEN_EXCLUDED_STAGES = ["won", "lost"];

// ---- UTM attribution ----
// Accepts top-level utm_source/... keys, or a nested "utm" object ({ utm_source } or { source }).
// Top-level keys win. Each value is trimmed and truncated to 255 chars; empty -> not saved.
const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
const utmClean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 255)
    .trim();
  return t || null;
};
function extractUtms(body: Record<string, unknown>): Record<string, string> {
  const nested =
    body.utm && typeof body.utm === "object" && !Array.isArray(body.utm)
      ? (body.utm as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v =
      utmClean(body[k]) ?? utmClean(nested[k]) ?? utmClean(nested[k.slice(4)]);
    if (v) out[k] = v;
  }
  return out;
}

async function getOrCreateTag(name: string, color: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("tags")
    .select("id")
    .eq("name", name)
    .limit(1);
  if (error) throw error;
  if (data?.[0]) return data[0].id as number;
  const { data: created, error: e2 } = await supabaseAdmin
    .from("tags")
    .insert({ name, color })
    .select("id")
    .single();
  if (e2) throw e2;
  return created.id as number;
}

// Put a deal at the top of a kanban column, like the CRM UI does.
async function moveToTop(stage: string) {
  const { data } = await supabaseAdmin
    .from("deals")
    .select("id, index")
    .eq("stage", stage);
  for (const d of data ?? []) {
    await supabaseAdmin
      .from("deals")
      .update({ index: (d.index ?? 0) + 1 })
      .eq("id", d.id);
  }
}

// Makes sure the contact has a company and an open deal (new-lead for fresh leads).
// Reuses what exists, never creates a second open deal for the same contact.
async function ensureCompanyAndDeal(
  contactId: number,
  fullName: string,
  isQuiz: boolean,
  salesId: number | null,
  description: string,
) {
  const { data: c } = await supabaseAdmin
    .from("contacts")
    .select("company_id")
    .eq("id", contactId)
    .single();
  let companyId: number | null = c?.company_id ?? null;
  if (!companyId) {
    const { data: company, error } = await supabaseAdmin
      .from("companies")
      .insert({
        name: `${fullName} (individual)`,
        description: `Created automatically from a ${isQuiz ? "quiz" : "landing page"} lead.`,
        sales_id: salesId,
      })
      .select("id")
      .single();
    if (error) throw error;
    companyId = company.id as number;
    await supabaseAdmin
      .from("contacts")
      .update({ company_id: companyId })
      .eq("id", contactId);
  }
  const { data: open } = await supabaseAdmin
    .from("deals")
    .select("id")
    .contains("contact_ids", [contactId])
    .is("archived_at", null)
    .not("stage", "in", `(${OPEN_EXCLUDED_STAGES.join(",")})`)
    .limit(1);
  if (open?.[0])
    return { companyId, dealId: open[0].id as number, createdDeal: false };
  await moveToTop("new-lead");
  const { data: deal, error } = await supabaseAdmin
    .from("deals")
    .insert({
      name: `${fullName} - ${isQuiz ? "quiz lead" : "new lead"}`,
      company_id: companyId,
      contact_ids: [contactId],
      category: "managed-ecommerce-retainer",
      stage: "new-lead",
      description,
      index: 0,
      sales_id: salesId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { companyId, dealId: deal.id as number, createdDeal: true };
}

// ---- Normalized lead fields (see migration 20261117140000_lead_fields) ----
// lead_source = slug of source_page ('quiz', 'quiz-v2', ...). Null when absent or not usable.
function normLeadSource(sourcePage: string): string | null {
  const slug = sourcePage
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return /^[a-z0-9][a-z0-9_-]*$/.test(slug) ? slug : null;
}
function normReadiness(v: string): string | null {
  const r = v.toLowerCase().trim();
  if (!r) return null;
  if (r.startsWith("yes, i'm ready")) return "ready";
  if (r.startsWith("yes")) return "details_first";
  if (r.startsWith("not")) return "not_sure";
  return null;
}
function normSituation(v: string): string | null {
  const s = v.toLowerCase().split(" \u2014 ")[0];
  if (!s.trim()) return null;
  if (s.includes("not profitable")) return "not_profitable";
  if (s.includes("don't have a store") || s.includes("no store"))
    return "starting";
  if (s.includes("profitable store")) return "profitable";
  if (s.includes("different business")) return "other";
  return null;
}
function normGoal(v: string): string | null {
  // The quiz sends situation as "<situation> \u2014 goal: <goal>".
  const m = v.toLowerCase().match(/goal:\s*(.*)$/);
  const g = m ? m[1] : "";
  if (g.startsWith("launch my first")) return "launch";
  if (g.startsWith("fix and grow")) return "fix_grow";
  if (g.startsWith("scale what")) return "scale";
  if (g.startsWith("add ecommerce")) return "add_ecom";
  return null;
}
function normTimeline(v: string): string | null {
  const t = v.toLowerCase().trim();
  if (!t) return null;
  if (t.startsWith("as soon as")) return "asap";
  if (/1\D{1,3}3 months/.test(t)) return "1_3_months";
  if (t.startsWith("just research") || t.includes("later")) return "later";
  return null;
}

function statusFromReadiness(readiness: string): string {
  const r = readiness.toLowerCase();
  if (r.startsWith("yes, i'm ready")) return "hot";
  if (r.startsWith("yes")) return "warm";
  return "cold";
}

// ---- Attribution (migration 20261127160000_attribution_capi) ----
// Website/quiz: event_id, fbc, fbp, fbclid, utm_id, page_url, landing_url, referrer, submitted_at,
//   first_touch (browser localStorage first touch), plus utm_*.
// Meta instant forms (pull routines, CSV columns): id|meta_lead_id|leadgen_id ("l:..."), created_time,
//   ad_id ("ag:"), ad_name, adset_id ("as:"), adset_name, campaign_id ("c:"), campaign_name,
//   form_id ("f:"), form_name, platform, is_organic. Prefixes are stripped.
// first_touch is set once (or replaced by an EARLIER touch); last_touch is set on every touch.
const idClean = (v: unknown) =>
  clean(v, 80)
    .replace(/^[a-z]{1,2}:/i, "")
    .replace(/[^0-9]/g, "");
const strOrNull = (v: unknown, max = 255) => clean(v, max) || null;
function isoOrNull(v: unknown): string | null {
  const s = clean(v, 60);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function prune(o: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o))
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  return out;
}
const TOUCH_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "fbclid",
  "landing_url",
  "referrer",
];
// Browser first-touch object -> only known keys, cleaned.
function cleanClientTouch(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const at = isoOrNull(o.at);
  if (!at) return null;
  const out: Record<string, unknown> = { at, channel: "website" };
  for (const k of TOUCH_KEYS) {
    const c = clean(o[k], k.endsWith("url") ? 1000 : 255);
    if (c) out[k] = c;
  }
  if (o.direct === true) out.direct = true;
  return out;
}
async function lookupNames(ids: string[]) {
  const want = ids.filter(Boolean);
  if (!want.length)
    return {} as Record<
      string,
      {
        name: string;
        level: string;
        campaign_id: string | null;
        adset_id: string | null;
      }
    >;
  const { data } = await supabaseAdmin
    .from("meta_ad_lookup")
    .select("object_id, name, level, campaign_id, adset_id")
    .in("object_id", want);
  const m: Record<
    string,
    {
      name: string;
      level: string;
      campaign_id: string | null;
      adset_id: string | null;
    }
  > = {};
  for (const r of data ?? []) m[r.object_id] = r;
  return m;
}
// Adds campaign/adset/ad names (and ids) to a website touch whose utm_content = ad id, utm_term = adset id.
async function enrichFromLookup(t: Record<string, unknown>) {
  const adId = /^\d{6,}$/.test(String(t.utm_content ?? ""))
    ? String(t.utm_content)
    : "";
  const adsetId = /^\d{6,}$/.test(String(t.utm_term ?? ""))
    ? String(t.utm_term)
    : "";
  if (!adId && !adsetId) return t;
  const m = await lookupNames([adId, adsetId]);
  const ad = adId ? m[adId] : undefined;
  const campaignId =
    ad?.campaign_id ?? (adsetId ? m[adsetId]?.campaign_id : null) ?? null;
  const camp = campaignId
    ? (await lookupNames([campaignId]))[campaignId]
    : undefined;
  return prune({
    ...t,
    ad_id: t.ad_id ?? (adId || null),
    ad_name: t.ad_name ?? ad?.name ?? null,
    adset_id: t.adset_id ?? (adsetId || ad?.adset_id || null),
    adset_name: t.adset_name ?? (adsetId ? m[adsetId]?.name : null) ?? null,
    campaign_id: t.campaign_id ?? campaignId,
    campaign_name: t.campaign_name ?? camp?.name ?? null,
  });
}
function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") ?? "";
  const ip = (
    req.headers.get("cf-connecting-ip") ??
    xf.split(",")[0] ??
    ""
  ).trim();
  return /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : "";
}
function runInBackground(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(p);
  else return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsFor(req) });
  }
  if (req.method !== "POST") {
    return json(req, 405, { success: false, message: "Method not allowed" });
  }

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 20_000) {
    return json(req, 413, { success: false, message: "Payload too large" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { success: false, message: "Invalid JSON" });
  }

  // Honeypot: bots fill hidden fields. Pretend success, store nothing.
  if (clean(body.website, 200)) {
    return json(req, 200, { success: true });
  }

  const fullName = clean(body.name ?? body.full_name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone ?? body.phone_number, 40).replace(/^p:/i, "");
  const situation = clean(body.situation, 200);
  const readiness = clean(body.readiness, 200);
  const timeline = clean(body.timeline, 200);
  const sourcePage = clean(body.source_page, 300);
  const consent = clean(body.consent, 100);
  const utms = extractUtms(body);

  if (
    !fullName ||
    !EMAIL_RE.test(email) ||
    phone.replace(/\D/g, "").length < 10
  ) {
    return json(req, 422, {
      success: false,
      message: "Please provide a valid name, email and phone number.",
    });
  }

  const parts = fullName.split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ") || "-";
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const testContact = isTestEmail(email);
  const testEventCode = testContact
    ? (clean(body.test_event_code, 40).match(/^TEST[A-Za-z0-9]{1,30}$/)?.[0] ??
      null)
    : null;

  // ---- attribution for this touch ----
  const metaLeadId = idClean(
    body.meta_lead_id ??
      body.leadgen_id ??
      (typeof body.id === "string" && /^l:/.test(body.id) ? body.id : ""),
  );
  const formId = idClean(body.form_id);
  const isInstantForm = Boolean(metaLeadId || formId);
  const createdTime = isoOrNull(body.created_time);
  let submittedAt = now;
  if (isInstantForm && createdTime) submittedAt = createdTime;
  else {
    const s = isoOrNull(body.submitted_at);
    if (
      s &&
      Date.parse(s) > nowMs - 86400_000 &&
      Date.parse(s) < nowMs + 300_000
    )
      submittedAt = s;
  }
  const evIdRaw = clean(body.event_id, 100);
  const eventId = /^[A-Za-z0-9._:-]{6,100}$/.test(evIdRaw) ? evIdRaw : "";
  const fbclid = clean(body.fbclid, 500);
  const fbcIn = clean(body.fbc, 600);
  const fbp = /^fb\.\d\.\d+\.\d+$/.test(clean(body.fbp, 100))
    ? clean(body.fbp, 100)
    : "";
  const pageUrlRaw = clean(body.page_url, 500);
  const pageUrl = /^https:\/\//.test(pageUrlRaw) ? pageUrlRaw : "";
  const fbc = fbcFrom(fbcIn, fbclid, Date.parse(submittedAt));
  const adId = idClean(body.ad_id);
  const adsetId = idClean(body.adset_id);
  const campaignId = idClean(body.campaign_id);

  let touch: Record<string, unknown>;
  if (isInstantForm) {
    touch = prune({
      at: submittedAt,
      recorded_at: now,
      channel: "meta_instant_form",
      source: normLeadSource(sourcePage),
      meta_lead_id: metaLeadId || null,
      campaign_id: campaignId || null,
      campaign_name: strOrNull(body.campaign_name),
      adset_id: adsetId || null,
      adset_name: strOrNull(body.adset_name),
      ad_id: adId || null,
      ad_name: strOrNull(body.ad_name),
      form_id: formId || null,
      form_name: strOrNull(body.form_name),
      platform: strOrNull(body.platform, 20),
      is_organic: strOrNull(body.is_organic, 10),
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: strOrNull(body.campaign_name),
      utm_content: adId || null,
      utm_term: adsetId || null,
    });
    // Learn id -> name pairs from the Meta export.
    type LookupRow = {
      object_id: string;
      level: string;
      name: string;
      campaign_id: string | null;
      adset_id: string | null;
      updated_at: string;
    };
    const rows: LookupRow[] = [];
    const add = (
      object_id: string,
      level: string,
      name: unknown,
      campaign_id: string | null = null,
      adset_id: string | null = null,
    ) => {
      const n = clean(name, 255);
      if (object_id && n)
        rows.push({
          object_id,
          level,
          name: n,
          campaign_id,
          adset_id,
          updated_at: now,
        });
    };
    add(campaignId, "campaign", body.campaign_name);
    add(adsetId, "adset", body.adset_name, campaignId || null);
    add(adId, "ad", body.ad_name, campaignId || null, adsetId || null);
    add(formId, "form", body.form_name);
    if (rows.length) {
      const { error } = await supabaseAdmin
        .from("meta_ad_lookup")
        .upsert(rows, { onConflict: "object_id" });
      if (error) console.error("meta_ad_lookup upsert failed", error.message);
    }
  } else {
    touch = await enrichFromLookup(
      prune({
        at: submittedAt,
        recorded_at: now,
        channel: "website",
        source: normLeadSource(sourcePage),
        page: sourcePage || null,
        page_url: pageUrl || null,
        landing_url: strOrNull(body.landing_url, 1000),
        referrer: strOrNull(body.referrer, 500),
        ...utms,
        utm_id: strOrNull(body.utm_id),
        fbclid: fbclid || null,
        fbc: fbc || null,
        fbp: fbp || null,
        event_id: eventId || null,
      }),
    );
  }

  // Same Meta lead pulled again (routines run every few hours): nothing to do.
  if (metaLeadId) {
    const { data: dup } = await supabaseAdmin
      .from("lead_touches")
      .select("contact_id")
      .eq("meta_lead_id", metaLeadId)
      .limit(1);
    if (dup?.[0]) {
      return json(req, 200, {
        success: true,
        duplicate: true,
        ...(testContact || isInstantForm
          ? { contact_id: dup[0].contact_id }
          : {}),
      });
    }
  }

  // Browser-side first touch (localStorage) counts as first touch for NEW contacts when it is
  // older than this submission and carries campaign params.
  const clientFirst = isInstantForm ? null : cleanClientTouch(body.first_touch);
  const firstTouchForNew =
    clientFirst &&
    !clientFirst.direct &&
    Date.parse(String(clientFirst.at)) < Date.parse(submittedAt) &&
    (clientFirst.utm_source || clientFirst.fbclid)
      ? await enrichFromLookup({
          ...clientFirst,
          recorded_at: now,
          source: normLeadSource(sourcePage),
          page: sourcePage || null,
        })
      : touch;
  const legacyUtm = (t: Record<string, unknown>) =>
    Object.fromEntries(
      UTM_KEYS.map((k) => [k, (t[k] as string | undefined) ?? null]),
    );

  const { data: tagRows, error: tagErr } = await supabaseAdmin
    .from("tags")
    .select("id")
    .eq("name", TAG_NAME)
    .limit(1);
  if (tagErr)
    return json(req, 500, { success: false, message: "Server error" });
  let tagId = tagRows?.[0]?.id as number | undefined;
  if (!tagId) {
    const { data: created, error } = await supabaseAdmin
      .from("tags")
      .insert({ name: TAG_NAME, color: TAG_COLOR })
      .select("id")
      .single();
    if (error)
      return json(req, 500, { success: false, message: "Server error" });
    tagId = created.id;
  }
  const isQuiz = /^quiz/.test(sourcePage.toLowerCase()); // quiz, quiz-v2, quiz-b ...
  const tagIds: number[] = [tagId!];
  if (isQuiz) {
    try {
      tagIds.push(await getOrCreateTag(QUIZ_TAG_NAME, QUIZ_TAG_COLOR));
    } catch (e) {
      console.error("quiz tag failed", String(e));
    }
  }

  // Simple flood protection: at most 30 landing-page submissions per 10 minutes.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("contact_notes")
    .select("id", { count: "exact", head: true })
    .gte("date", since)
    .like("text", "Landing page form submission%");
  if ((count ?? 0) >= 30) {
    return json(req, 429, {
      success: false,
      message: "Too many submissions, please try again later.",
    });
  }

  // First sales user, if any (lowest id = the admin who signed up first).
  const { data: sales } = await supabaseAdmin
    .from("sales")
    .select("id")
    .order("id", { ascending: true })
    .limit(1);
  const salesId: number | null = sales?.[0]?.id ?? null;

  const t = touch as Record<string, string | undefined>;
  const sourceLines = isInstantForm
    ? `- Source: Meta instant form\n` +
      `- Campaign: ${t.campaign_name ?? "n/a"} (${t.campaign_id ?? "n/a"})\n` +
      `- Ad set: ${t.adset_name ?? "n/a"} (${t.adset_id ?? "n/a"})\n` +
      `- Ad: ${t.ad_name ?? "n/a"} (${t.ad_id ?? "n/a"})\n` +
      `- Form: ${t.form_name ?? "n/a"} (${t.form_id ?? "n/a"})\n` +
      `- Meta lead id: ${t.meta_lead_id ?? "n/a"} | platform: ${t.platform ?? "n/a"}\n` +
      `- Submitted: ${submittedAt}\n`
    : (t.utm_source || t.fbclid
        ? `- Source: ${t.utm_source ?? "-"} / ${t.utm_medium ?? "-"} / ${t.utm_campaign ?? "-"}\n` +
          (t.ad_id || t.adset_id
            ? `- Ad: ${t.ad_name ?? "?"} (${t.ad_id ?? "?"}) | Ad set: ${t.adset_name ?? "?"} (${t.adset_id ?? "?"}) | Campaign: ${t.campaign_name ?? "?"}\n`
            : "") +
          (t.fbclid ? `- fbclid: yes\n` : "")
        : `- Source: no UTM / direct\n`) + `- Submitted: ${submittedAt}\n`;

  const noteText =
    `Landing page form submission\n\n` +
    `- Situation: ${situation || "n/a"}\n` +
    `- Ready to work with a done-for-you team and fund own ad spend: ${readiness || "n/a"}\n` +
    `- Timeline: ${timeline || "n/a"}\n` +
    `- Consent: ${consent || "n/a"}\n` +
    `- Phone: ${phone}\n` +
    (sourcePage ? `- Page: ${sourcePage}\n` : "") +
    sourceLines;

  // Existing contact with this email? Add a note instead of creating a duplicate.
  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, tags, lead_source, first_touch, utm_source, utm_medium, utm_campaign, utm_content, utm_term, meta_lead_id, fbc, fbp, submitted_at",
    )
    .contains("email_jsonb", JSON.stringify([{ email }]))
    .limit(1);

  const leadFields: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    readiness: normReadiness(readiness),
    situation: normSituation(situation),
    timeline: normTimeline(timeline),
    goal: normGoal(situation),
  })) {
    if (v) leadFields[k] = v;
  }

  let contactId: number;
  let contactFbc = fbc,
    contactFbp = fbp;
  if (existing && existing.length > 0) {
    const ex = existing[0];
    contactId = ex.id;
    const tags: number[] = Array.from(new Set([...(ex.tags ?? []), ...tagIds]));
    const oldFirst = ex.first_touch as Record<string, unknown> | null;
    const hasLegacyUtm = Boolean(
      ex.utm_source ||
        ex.utm_medium ||
        ex.utm_campaign ||
        ex.utm_content ||
        ex.utm_term,
    );
    // First touch: set when empty, or replaced by an EARLIER touch (backdated Meta import).
    const earlier =
      oldFirst?.at &&
      Date.parse(String(touch.at)) < Date.parse(String(oldFirst.at));
    const setFirst = !oldFirst ? !hasLegacyUtm : Boolean(earlier);
    const update: Record<string, unknown> = {
      tags,
      last_seen: now,
      ...leadFields,
      last_touch: touch,
    };
    if (setFirst) {
      update.first_touch = touch;
      update.submitted_at = submittedAt;
      Object.assign(update, legacyUtm(touch));
      if (normLeadSource(sourcePage))
        update.lead_source = normLeadSource(sourcePage);
    } else {
      if (!hasLegacyUtm && Object.keys(utms).length)
        Object.assign(update, legacyUtm(touch));
      if (!ex.lead_source && normLeadSource(sourcePage))
        update.lead_source = normLeadSource(sourcePage);
      if (!ex.submitted_at) update.submitted_at = submittedAt;
    }
    if (metaLeadId && !ex.meta_lead_id) update.meta_lead_id = metaLeadId;
    if (fbc && !ex.fbc) update.fbc = fbc;
    if (fbp && !ex.fbp) update.fbp = fbp;
    contactFbc = ex.fbc || fbc;
    contactFbp = ex.fbp || fbp;
    await supabaseAdmin.from("contacts").update(update).eq("id", contactId);
  } else {
    const ft = firstTouchForNew;
    const { data: contact, error } = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name: firstName,
        last_name: lastName,
        email_jsonb: [{ email, type: "Work" }],
        phone_jsonb: [{ number: phone, type: "Work" }],
        background: isInstantForm
          ? `Meta instant form lead (${t.form_name ?? "form"}). Ad: ${t.ad_name ?? "n/a"}. Situation: ${situation || "n/a"}.`
          : `Landing page lead. Situation: ${situation || "n/a"}. Timeline: ${timeline || "n/a"}.`,
        status: statusFromReadiness(readiness),
        tags: tagIds,
        first_seen: now,
        last_seen: now,
        has_newsletter: false,
        sales_id: salesId,
        lead_source: normLeadSource(sourcePage),
        ...leadFields,
        ...legacyUtm(ft),
        first_touch: ft,
        last_touch: touch,
        submitted_at: (ft.at as string) ?? submittedAt,
        meta_lead_id: metaLeadId || null,
        fbc: fbc || null,
        fbp: fbp || null,
      })
      .select("id")
      .single();
    if (error) {
      console.error("contact insert failed", error.message);
      return json(req, 500, { success: false, message: "Server error" });
    }
    contactId = contact.id;
  }

  {
    const { error } = await supabaseAdmin.from("lead_touches").insert({
      contact_id: contactId,
      touch_at: submittedAt,
      channel: isInstantForm ? "meta_instant_form" : "website",
      meta_lead_id: metaLeadId || null,
      event_id: eventId || null,
      attribution: touch,
    });
    if (error) console.error("lead_touches insert failed", error.message);
  }

  await supabaseAdmin.from("contact_notes").insert({
    contact_id: contactId,
    text: noteText,
    date: now,
    status: statusFromReadiness(readiness),
    sales_id: salesId,
  });

  const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabaseAdmin.from("tasks").insert({
    contact_id: contactId,
    type: "call",
    text: "Call new lead",
    due_date: due,
    sales_id: salesId,
  });

  // Company + open deal in "New lead". Failure here must not lose the lead.
  try {
    await ensureCompanyAndDeal(
      contactId,
      fullName,
      isQuiz,
      salesId,
      `${isInstantForm ? "Meta instant form" : isQuiz ? "Quiz" : "Landing page"} lead. Situation: ${situation || "n/a"}. Readiness: ${readiness || "n/a"}. Timeline: ${timeline || "n/a"}.`,
    );
  } catch (e) {
    console.error("company/deal creation failed", String(e));
  }

  // ---- Meta Conversions API: Lead ----
  let capi: { status: string; httpStatus?: number } = { status: "pending" };
  const capiJob = (async () => {
    try {
      if (testContact && !testEventCode) {
        capi = { status: "skipped_test_contact" };
        return;
      }
      const phoneDigits = normPhone(phone);
      const userData = await buildUserData({
        email,
        phone,
        firstName,
        lastName,
        country:
          phoneDigits.length === 11 && phoneDigits.startsWith("1")
            ? "us"
            : null,
        contactId,
        leadId: isInstantForm ? metaLeadId : null,
        fbc: isInstantForm ? null : contactFbc,
        fbp: isInstantForm ? null : contactFbp,
        ip: isInstantForm ? null : clientIp(req),
        userAgent: isInstantForm
          ? null
          : clean(req.headers.get("user-agent"), 500),
      });
      capi = await sendCapi(
        isInstantForm
          ? {
              event_name: "Lead",
              event_time: Math.floor(Date.parse(submittedAt) / 1000),
              event_id: `metalead.${metaLeadId || contactId}.Lead`,
              action_source: "system_generated",
              user_data: userData,
              custom_data: {
                event_source: "crm",
                lead_event_source: LEAD_EVENT_SOURCE,
              },
            }
          : {
              event_name: "Lead",
              event_time: Math.floor(Date.parse(submittedAt) / 1000),
              event_id: eventId || `lead.srv.${crypto.randomUUID()}`,
              action_source: "website",
              event_source_url:
                pageUrl ||
                `https://ernestponz-create.github.io/ecom-syndicate/${sourcePage || "quiz"}/`,
              user_data: userData,
              custom_data: { content_name: `${sourcePage || "website"}_lead` },
            },
        { contactId, testEventCode },
      );
    } catch (e) {
      console.error("capi lead failed", String(e));
      capi = { status: "error" };
    }
  })();
  // Test contacts wait for the CAPI result so the test can report it; real leads don't wait.
  if (testContact) await capiJob;
  else await runInBackground(capiJob);

  return json(req, 200, {
    success: true,
    ...(testContact ? { contact_id: contactId, capi } : {}),
    ...(isInstantForm && !testContact ? { contact_id: contactId } : {}),
  });
});
