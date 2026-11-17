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
    .from("contacts")
    .select("id, tags, lead_source")
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
  if (existing && existing.length > 0) {
    contactId = existing[0].id;
    const tags: number[] = Array.from(
      new Set([...(existing[0].tags ?? []), ...tagIds]),
    );
    // Latest answers win; an existing lead_source is never overwritten (first touch).
    await supabaseAdmin
      .from("contacts")
      .update({
        tags,
        last_seen: now,
        ...leadFields,
        ...(existing[0].lead_source || !normLeadSource(sourcePage)
          ? {}
          : { lead_source: normLeadSource(sourcePage) }),
      })
      .eq("id", contactId);
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
        tags: tagIds,
        first_seen: now,
        last_seen: now,
        has_newsletter: false,
        sales_id: salesId,
        lead_source: normLeadSource(sourcePage),
        ...leadFields,
      })
      .select("id")
      .single();
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

  // Company + open deal in "New lead". Failure here must not lose the lead.
  try {
    await ensureCompanyAndDeal(
      contactId,
      fullName,
      isQuiz,
      salesId,
      `${isQuiz ? "Quiz" : "Landing page"} lead. Situation: ${situation || "n/a"}. Readiness: ${readiness || "n/a"}. Timeline: ${timeline || "n/a"}.`,
    );
  } catch (e) {
    console.error("company/deal creation failed", String(e));
  }

  return json(req, 200, { success: true });
});
