// Calendly -> CRM webhook receiver.
//
// Calendly calls this endpoint for invitee.created and invitee.canceled (user-scoped
// webhook subscription). Every request must carry a valid Calendly-Webhook-Signature
// header (HMAC-SHA256 with the CALENDLY_WEBHOOK_SIGNING_KEY function secret).
//
// invitee.created
//   - Upserts the contact by email (tag "Calendly booking", status warm for new contacts)
//   - Links / creates a company (the CRM UI requires a company on deals)
//   - Adds a contact note with booking time (Israel time + invitee time), event, Q&A,
//     UTM/source info and reschedule/cancel links
//   - Creates a deal in stage "Call booked", or moves the contact's open deal there
//   - Creates a "Prep for call" task due at the meeting start time
// invitee.canceled
//   - Adds a contact + deal note (marked as reschedule when Calendly says so)
//   - Closes the prep task of the canceled meeting
//   - Real cancellation (not a reschedule): moves the open deal back to "New lead"
//
// Idempotent: each Calendly invitee URI + event type is recorded in the note text, so
// Calendly retries do not create duplicates.
import { supabaseAdmin as db } from "../_shared/supabaseAdmin.ts";

const SIGNING_KEY = Deno.env.get("CALENDLY_WEBHOOK_SIGNING_KEY") ?? "";
const TOLERANCE_SECONDS = 5 * 60;
const TAG_NAME = "Calendly booking";
const TAG_COLOR = "#a4c2f4";
const CRM_TZ = "Asia/Jerusalem";
const OPEN_EXCLUDED_STAGES = ["won", "lost"];

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const clean = (v: unknown, max = 500) =>
  typeof v === "string"
    ? v
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, max)
    : "";

// ---------- signature ----------
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    k,
    new TextEncoder().encode(msg),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(header: string | null, rawBody: string) {
  if (!SIGNING_KEY || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1 || !/^\d+$/.test(t)) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_SECONDS) return false;
  const expected = await hmacHex(SIGNING_KEY, `${t}.${rawBody}`);
  return timingSafeEqual(expected, v1.toLowerCase());
}

// ---------- formatting ----------
function fmt(iso: string, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function whenText(start: string, end: string, inviteeTz: string) {
  let s = `${fmt(start, CRM_TZ)} - ${fmt(end, CRM_TZ).split(", ").pop()} (Israel time)`;
  if (inviteeTz && inviteeTz !== CRM_TZ) {
    s += ` / ${fmt(start, inviteeTz)} (${inviteeTz}, lead's time)`;
  }
  return s;
}

type QA = { question?: string; answer?: string; position?: number };

function findPhone(p: Record<string, any>, qas: QA[]) {
  const direct = clean(p.text_reminder_number, 40);
  if (direct) return direct;
  for (const qa of qas) {
    const q = (qa.question ?? "").toLowerCase();
    const a = clean(qa.answer, 40);
    if (
      a &&
      /(phone|mobile|whats ?app|cell|number)/.test(q) &&
      a.replace(/\D/g, "").length >= 7
    ) {
      return a;
    }
  }
  return "";
}

function findCompanyHint(qas: QA[]) {
  for (const qa of qas) {
    const q = (qa.question ?? "").toLowerCase();
    const a = clean(qa.answer, 120);
    if (a && /(company|business|brand|store|shop|website|url)/.test(q))
      return a;
  }
  return "";
}

// ---------- db helpers ----------
async function firstSalesId(): Promise<number | null> {
  const { data } = await db
    .from("sales")
    .select("id")
    .order("id", { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function tagId(): Promise<number> {
  const { data, error } = await db
    .from("tags")
    .select("id")
    .eq("name", TAG_NAME)
    .limit(1);
  if (error) throw error;
  if (data?.[0]) return data[0].id;
  const { data: created, error: e2 } = await db
    .from("tags")
    .insert({ name: TAG_NAME, color: TAG_COLOR })
    .select("id")
    .single();
  if (e2) throw e2;
  return created.id;
}

async function findContact(email: string) {
  const { data, error } = await db
    .from("contacts")
    .select("id, tags, company_id, phone_jsonb, first_name, last_name")
    .contains("email_jsonb", JSON.stringify([{ email }]))
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function alreadyProcessed(ref: string) {
  const { count, error } = await db
    .from("contact_notes")
    .select("id", { count: "exact", head: true })
    .like("text", `%${ref}%`);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function openDeal(contactId: number) {
  const { data, error } = await db
    .from("deals")
    .select("id, stage, index")
    .contains("contact_ids", [contactId])
    .is("archived_at", null)
    .not("stage", "in", `(${OPEN_EXCLUDED_STAGES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

// Put a deal at the top of a kanban column, like the CRM UI does.
async function moveToTop(stage: string, excludeId?: number) {
  const { data } = await db
    .from("deals")
    .select("id, index")
    .eq("stage", stage);
  for (const d of data ?? []) {
    if (d.id === excludeId) continue;
    await db
      .from("deals")
      .update({ index: (d.index ?? 0) + 1 })
      .eq("id", d.id);
  }
}

async function setDealStage(dealId: number, stage: string) {
  await moveToTop(stage, dealId);
  await db
    .from("deals")
    .update({ stage, index: 0, updated_at: new Date().toISOString() })
    .eq("id", dealId);
}

// ---------- handlers ----------
async function handleCreated(p: Record<string, any>) {
  const email = clean(p.email, 200).toLowerCase();
  if (!email) return { skipped: "no email" };
  const inviteeUri = clean(p.uri, 300);
  const ref = `[ref: ${inviteeUri || email} created]`;
  if (inviteeUri && (await alreadyProcessed(ref))) return { duplicate: true };

  const ev = p.scheduled_event ?? {};
  const start = clean(ev.start_time, 40);
  const end = clean(ev.end_time, 40);
  const eventName = clean(ev.name, 200) || "Calendly call";
  const qas: QA[] = Array.isArray(p.questions_and_answers)
    ? p.questions_and_answers
    : [];
  const tracking = p.tracking ?? {};
  const inviteeTz = clean(p.timezone, 60);
  const phone = findPhone(p, qas);
  const fullName =
    clean(p.name, 120) ||
    [clean(p.first_name, 60), clean(p.last_name, 60)]
      .filter(Boolean)
      .join(" ") ||
    email;
  const firstName = clean(p.first_name, 60) || fullName.split(/\s+/)[0];
  const lastName =
    clean(p.last_name, 60) || fullName.split(/\s+/).slice(1).join(" ") || "-";
  const isReschedule = Boolean(p.old_invitee);
  const location = ev.location ?? {};
  const joinUrl =
    clean(location.join_url, 300) || clean(location.location, 300);
  const now = new Date().toISOString();
  const salesId = await firstSalesId();
  const tid = await tagId();

  const trackingLines = Object.entries(tracking)
    .filter(([, v]) => typeof v === "string" && v)
    .map(([k, v]) => `${k}=${clean(v, 200)}`);
  const sourceLine = trackingLines.length
    ? trackingLines.join(", ")
    : "Calendly (no UTM)";

  // Attribution touch from Calendly's tracking params (utm_* passed through the embed URL).
  const touchAt =
    clean(p.created_at, 40) &&
    Number.isFinite(Date.parse(clean(p.created_at, 40)))
      ? new Date(Date.parse(clean(p.created_at, 40))).toISOString()
      : now;
  const touch: Record<string, unknown> = {
    at: touchAt,
    recorded_at: now,
    channel: "calendly",
  };
  for (const k of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "salesforce_uuid",
  ]) {
    const v = clean(tracking[k], 255);
    if (v) touch[k] = v;
  }
  if (eventName) touch.event = eventName;

  // Contact
  const contact = await findContact(email);
  let contactId: number;
  let companyId: number | null = contact?.company_id ?? null;

  if (!companyId) {
    const hint = findCompanyHint(qas);
    const isUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(hint);
    const { data: company, error } = await db
      .from("companies")
      .insert({
        name: hint || `${fullName} (individual)`,
        website: isUrl ? hint : null,
        description: `Created automatically from a Calendly booking by ${fullName}.`,
        sales_id: salesId,
      })
      .select("id")
      .single();
    if (error) throw error;
    companyId = company.id;
  }

  if (contact) {
    contactId = contact.id;
    const tags = Array.from(new Set([...(contact.tags ?? []), tid]));
    const phones = Array.isArray(contact.phone_jsonb)
      ? contact.phone_jsonb
      : [];
    const update: Record<string, unknown> = {
      tags,
      last_seen: now,
      company_id: companyId,
      // Latest touch only. first_touch / utm_* / lead_source are never changed here
      // (and a DB trigger blocks overwrites anyway).
      last_touch: touch,
    };
    if (
      phone &&
      !phones.some(
        (x: any) =>
          (x?.number ?? "").replace(/\D/g, "") === phone.replace(/\D/g, ""),
      )
    ) {
      update.phone_jsonb = [...phones, { number: phone, type: "Work" }];
    }
    const { error } = await db
      .from("contacts")
      .update(update)
      .eq("id", contactId);
    if (error) throw error;
  } else {
    const { data: created, error } = await db
      .from("contacts")
      .insert({
        first_name: firstName,
        last_name: lastName,
        email_jsonb: [{ email, type: "Work" }],
        phone_jsonb: phone ? [{ number: phone, type: "Work" }] : [],
        background: `Booked a call via Calendly. Source: ${sourceLine}.`,
        status: "warm",
        tags: [tid],
        company_id: companyId,
        first_seen: now,
        last_seen: now,
        has_newsletter: false,
        sales_id: salesId,
        first_touch: touch,
        last_touch: touch,
        submitted_at: touchAt,
        ...Object.fromEntries(
          [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_content",
            "utm_term",
          ].map((k) => [k, (touch[k] as string | undefined) ?? null]),
        ),
      })
      .select("id")
      .single();
    if (error) throw error;
    contactId = created.id;
  }

  {
    const { error: tErr } = await db.from("lead_touches").insert({
      contact_id: contactId,
      touch_at: touchAt,
      channel: "calendly",
      attribution: touch,
    });
    if (tErr) console.error("lead_touches insert failed", tErr.message);
  }

  // Note
  const when = start
    ? whenText(start, end || start, inviteeTz)
    : "unknown time";
  const qaText = qas.length
    ? qas
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(
          (qa) =>
            `- ${clean(qa.question, 300)}: ${clean(qa.answer, 2000) || "n/a"}`,
        )
        .join("\n")
    : "- (no answers)";
  const noteText =
    `${isReschedule ? "Calendly call RESCHEDULED (new time)" : "Calendly call booked"}\n\n` +
    `- Event: ${eventName}\n` +
    `- When: ${when}\n` +
    (joinUrl ? `- Location / join link: ${joinUrl}\n` : "") +
    (phone ? `- Phone: ${phone}\n` : "") +
    `- Source: ${sourceLine}\n` +
    (p.reschedule_url
      ? `- Reschedule link: ${clean(p.reschedule_url, 300)}\n`
      : "") +
    (p.cancel_url ? `- Cancel link: ${clean(p.cancel_url, 300)}\n` : "") +
    `\nAnswers:\n${qaText}\n\n${ref}`;
  const { error: noteErr } = await db.from("contact_notes").insert({
    contact_id: contactId,
    text: noteText,
    date: now,
    status: "warm",
    sales_id: salesId,
  });
  if (noteErr) throw noteErr;

  // Deal
  const existing = await openDeal(contactId);
  let dealId: number;
  if (existing) {
    dealId = existing.id;
    if (existing.stage === "new-lead")
      await setDealStage(dealId, "call-booked");
  } else {
    await moveToTop("call-booked");
    const { data: deal, error } = await db
      .from("deals")
      .insert({
        name: `${fullName} - discovery call`,
        company_id: companyId,
        contact_ids: [contactId],
        category: "managed-ecommerce-retainer",
        stage: "call-booked",
        description: `Booked via Calendly (${eventName}) for ${when}. Source: ${sourceLine}.`,
        index: 0,
        sales_id: salesId,
      })
      .select("id")
      .single();
    if (error) throw error;
    dealId = deal.id;
  }
  await db.from("deal_notes").insert({
    deal_id: dealId,
    type: "Calendly",
    text: `${isReschedule ? "Call rescheduled" : "Call booked"} via Calendly: ${when}.`,
    date: now,
    sales_id: salesId,
  });

  // Prep task due at meeting start
  if (start) {
    await db.from("tasks").insert({
      contact_id: contactId,
      type: "meeting",
      text:
        `Prep for Calendly call with ${fullName} (${fmt(start, CRM_TZ)} Israel time)` +
        (joinUrl ? ` - ${joinUrl}` : ""),
      due_date: start,
      sales_id: salesId,
    });
  }

  return { contactId, dealId, companyId };
}

async function handleCanceled(p: Record<string, any>) {
  const email = clean(p.email, 200).toLowerCase();
  if (!email) return { skipped: "no email" };
  const inviteeUri = clean(p.uri, 300);
  const ref = `[ref: ${inviteeUri || email} canceled]`;
  if (inviteeUri && (await alreadyProcessed(ref))) return { duplicate: true };

  const contact = await findContact(email);
  if (!contact) return { skipped: "unknown contact" };

  const ev = p.scheduled_event ?? {};
  const start = clean(ev.start_time, 40);
  const end = clean(ev.end_time, 40);
  const inviteeTz = clean(p.timezone, 60);
  const isReschedule = Boolean(p.rescheduled);
  const c = p.cancellation ?? {};
  const reason = clean(c.reason, 1000);
  const by = clean(c.canceled_by, 120);
  const when = start
    ? whenText(start, end || start, inviteeTz)
    : "unknown time";
  const now = new Date().toISOString();
  const salesId = await firstSalesId();

  const noteText = isReschedule
    ? `Calendly call RESCHEDULED - old slot released\n\n- Old time: ${when}\n` +
      `- The new booking is logged in its own note.\n` +
      (reason ? `- Reason: ${reason}\n` : "") +
      `\n${ref}`
    : `Calendly call CANCELED\n\n- Was: ${when}\n` +
      (by ? `- Canceled by: ${by}\n` : "") +
      `- Reason: ${reason || "none given"}\n\n${ref}`;
  await db.from("contact_notes").insert({
    contact_id: contact.id,
    text: noteText,
    date: now,
    status: isReschedule ? "warm" : "cold",
    sales_id: salesId,
  });

  // Close the prep task for the canceled slot
  if (start) {
    await db
      .from("tasks")
      .update({ done_date: now })
      .eq("contact_id", contact.id)
      .eq("due_date", start)
      .is("done_date", null)
      .like("text", "Prep for Calendly call%");
  }

  const deal = await openDeal(contact.id);
  if (deal) {
    if (!isReschedule && deal.stage === "call-booked")
      await setDealStage(deal.id, "new-lead");
    await db.from("deal_notes").insert({
      deal_id: deal.id,
      type: "Calendly",
      text: isReschedule
        ? `Call rescheduled (old slot: ${when}).`
        : `Call canceled (was ${when}). Reason: ${reason || "none given"}. Moved back to New lead.`,
      date: now,
      sales_id: salesId,
    });
  }
  return { contactId: contact.id, dealId: deal?.id ?? null };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });
  const raw = await req.text();
  if (raw.length > 200_000) return json(413, { ok: false });
  if (
    !(await verifySignature(req.headers.get("calendly-webhook-signature"), raw))
  ) {
    return json(401, { ok: false, message: "Invalid signature" });
  }
  let body: Record<string, any>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, message: "Invalid JSON" });
  }
  try {
    const p = body.payload ?? {};
    let result: Record<string, unknown>;
    if (body.event === "invitee.created") result = await handleCreated(p);
    else if (body.event === "invitee.canceled")
      result = await handleCanceled(p);
    else result = { ignored: body.event ?? null };
    return json(200, { ok: true, ...result });
  } catch (e) {
    console.error(
      "calendly-webhook failed",
      e instanceof Error ? e.message : JSON.stringify(e),
    );
    return json(500, { ok: false }); // Calendly will retry
  }
});
