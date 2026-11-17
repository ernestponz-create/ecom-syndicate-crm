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
// SECURITY TODO: CORS currently allows any origin. Once the GitHub Pages domain is final, set the
// ALLOWED_ORIGINS secret (comma separated, e.g. https://ernestponz-create.github.io) to restrict it.
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

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
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
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
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TAG_NAME = "Landing page / Meta ads";
const TAG_COLOR = "#e8cb7d";

function statusFromReadiness(readiness: string): string {
  const r = readiness.toLowerCase();
  if (r.startsWith("yes, i'm ready")) return "hot";
  if (r.startsWith("yes")) return "warm";
  return "cold";
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

  const fullName = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 40);
  const situation = clean(body.situation, 200);
  const readiness = clean(body.readiness, 200);
  const timeline = clean(body.timeline, 200);
  const sourcePage = clean(body.source_page, 300);
  const consent = clean(body.consent, 100);

  if (!fullName || !EMAIL_RE.test(email) || phone.replace(/\D/g, "").length < 10) {
    return json(req, 422, { success: false, message: "Please provide a valid name, email and phone number." });
  }

  const parts = fullName.split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ") || "-";
  const now = new Date().toISOString();

  const { data: tagRows, error: tagErr } = await supabaseAdmin
    .from("tags").select("id").eq("name", TAG_NAME).limit(1);
  if (tagErr) return json(req, 500, { success: false, message: "Server error" });
  let tagId = tagRows?.[0]?.id as number | undefined;
  if (!tagId) {
    const { data: created, error } = await supabaseAdmin
      .from("tags").insert({ name: TAG_NAME, color: TAG_COLOR }).select("id").single();
    if (error) return json(req, 500, { success: false, message: "Server error" });
    tagId = created.id;
  }

  // Simple flood protection: at most 30 landing-page submissions per 10 minutes.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("contact_notes").select("id", { count: "exact", head: true })
    .gte("date", since).like("text", "Landing page form submission%");
  if ((count ?? 0) >= 30) {
    return json(req, 429, { success: false, message: "Too many submissions, please try again later." });
  }

  // First sales user, if any (lowest id = the admin who signed up first).
  const { data: sales } = await supabaseAdmin
    .from("sales").select("id").order("id", { ascending: true }).limit(1);
  const salesId: number | null = sales?.[0]?.id ?? null;

  const noteText =
    `Landing page form submission\n\n` +
    `- Situation: ${situation || "n/a"}\n` +
    `- Ready to work with a done-for-you team and fund own ad spend: ${readiness || "n/a"}\n` +
    `- Timeline: ${timeline || "n/a"}\n` +
    `- Consent: ${consent || "n/a"}\n` +
    `- Phone: ${phone}\n` +
    (sourcePage ? `- Page: ${sourcePage}\n` : "");

  // Existing contact with this email? Add a note instead of creating a duplicate.
  const { data: existing } = await supabaseAdmin
    .from("contacts").select("id, tags")
    .contains("email_jsonb", JSON.stringify([{ email }])).limit(1);

  let contactId: number;
  if (existing && existing.length > 0) {
    contactId = existing[0].id;
    const tags: number[] = Array.from(new Set([...(existing[0].tags ?? []), tagId]));
    await supabaseAdmin.from("contacts").update({ tags, last_seen: now }).eq("id", contactId);
  } else {
    const { data: contact, error } = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name: firstName,
        last_name: lastName,
        email_jsonb: [{ email, type: "Work" }],
        phone_jsonb: [{ number: phone, type: "Work" }],
        background: `Landing page lead. Situation: ${situation || "n/a"}. Timeline: ${timeline || "n/a"}.`,
        status: statusFromReadiness(readiness),
        tags: [tagId],
        first_seen: now,
        last_seen: now,
        has_newsletter: false,
        sales_id: salesId,
      })
      .select("id").single();
    if (error) {
      console.error("contact insert failed", error.message);
      return json(req, 500, { success: false, message: "Server error" });
    }
    contactId = contact.id;
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

  return json(req, 200, { success: true });
});
