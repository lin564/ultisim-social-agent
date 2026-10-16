import { z } from "zod";
import { ask } from "../claude.js";
import { loadBrand, systemPrompt, entityById } from "../brand.js";
import { json, parseJson } from "../db.js";
import { notify, dashboardLink } from "../notify.js";

const ConferenceSchema = z.object({
  conferences: z.array(z.object({
    name: z.string().describe("Short canonical name, e.g. 'I/ITSEC'"),
    edition: z.string().describe("Year or edition, e.g. '2027'"),
    url: z.string().nullable(),
    cfp_url: z.string().nullable().describe("Page for submitting proposals, abstracts or papers"),
    location: z.string().nullable(),
    event_start: z.string().nullable().describe("YYYY-MM-DD"),
    event_end: z.string().nullable().describe("YYYY-MM-DD"),
    cfp_deadline: z.string().nullable().describe("YYYY-MM-DD of the next proposal deadline; null if not announced yet"),
    fit: z.string().describe("Why this is worth our time and what we could present"),
    speakers: z.array(z.string()).describe("Entity ids of the best-suited speakers"),
  })),
});

/** Finds conferences worth presenting at and records their call-for-papers deadlines. */
export async function scoutConferences(db) {
  const brand = loadBrand();
  const today = new Date().toISOString().slice(0, 10);
  const tracked = db.prepare("SELECT name, edition, cfp_deadline FROM conferences WHERE event_start IS NULL OR event_start >= date('now')").all();

  const { conferences } = await ask({
    system: systemPrompt(brand),
    webSearch: 12,
    effort: "high",
    schema: ConferenceSchema,
    prompt: `Today is ${today}. Find conferences where ${brand.conferences.speakers.map((id) => entityById(brand, id)?.name).join(" and ")} should be presenting, in these fields: ${brand.conferences.fields.join("; ")}.
Regions: ${brand.conferences.regions}
Start with these, then find others of similar standing: ${brand.conferences.seed.join(", ")}.

For each, find the next edition whose call for speakers, papers, panels or workshops is open or not yet announced, and its deadline from the official site. Do not guess a deadline: use null if it is not published. Skip editions whose deadline has passed.

Already tracked (refresh their deadlines if they changed): ${JSON.stringify(tracked)}`,
  });

  const upsert = db.prepare(`INSERT INTO conferences (name, edition, url, cfp_url, location, event_start, event_end, cfp_deadline, fit, speakers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (name, edition) DO UPDATE SET
      url = coalesce(excluded.url, url), cfp_url = coalesce(excluded.cfp_url, cfp_url),
      location = coalesce(excluded.location, location), event_start = coalesce(excluded.event_start, event_start),
      event_end = coalesce(excluded.event_end, event_end), cfp_deadline = coalesce(excluded.cfp_deadline, cfp_deadline),
      fit = excluded.fit, updated_at = datetime('now')`);
  const before = db.prepare("SELECT count(*) AS n FROM conferences").get().n;
  for (const c of conferences) {
    upsert.run(c.name, c.edition, c.url, c.cfp_url, c.location, c.event_start, c.event_end, c.cfp_deadline, c.fit, json(c.speakers));
  }
  const added = db.prepare("SELECT count(*) AS n FROM conferences").get().n - before;
  if (added) await notify(`Found ${added} new conference${added === 1 ? "" : "s"} to consider presenting at. ${dashboardLink("#conferences")}`);
  return { found: conferences.length, added };
}

/** Calendar days from today (UTC) to a YYYY-MM-DD date: 0 on the day itself, negative once passed. */
const daysUntil = (date, now = new Date()) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/**
 * Nags about open calls for papers we haven't submitted to, once per threshold
 * (e.g. 30, 14, 7, 3, 1 days out), and marks calls we let pass as missed.
 */
export async function remindDeadlines(db, { now = new Date() } = {}) {
  const thresholds = [...loadBrand().conferences.remindDaysBefore].sort((a, b) => b - a);
  const open = db.prepare(`SELECT * FROM conferences WHERE status IN ('watching', 'applying') AND cfp_deadline IS NOT NULL`).all();
  const lines = [];

  for (const c of open) {
    const left = daysUntil(c.cfp_deadline, now);
    if (left < 0) {
      db.prepare("UPDATE conferences SET status = 'missed', updated_at = datetime('now') WHERE id = ?").run(c.id);
      continue;
    }
    const due = thresholds.filter((t) => left <= t).at(-1);
    if (due === undefined || (c.last_reminded_days !== null && c.last_reminded_days <= due)) continue;
    db.prepare("UPDATE conferences SET last_reminded_days = ? WHERE id = ?").run(due, c.id);
    const step = c.status === "applying" ? (c.abstract ? "abstract drafted, needs submitting" : "marked applying, no abstract yet") : "not started";
    lines.push(`• *${c.name} ${c.edition}*: proposals due ${c.cfp_deadline} (${left === 0 ? "today" : `${left} day${left === 1 ? "" : "s"}`}), ${step}. ${c.cfp_url ?? c.url ?? ""}`);
  }

  if (lines.length) await notify(`Call-for-papers deadlines coming up:\n${lines.join("\n")}\n${dashboardLink("#conferences")}`);
  return { reminded: lines.length };
}

const AbstractSchema = z.object({
  title: z.string(),
  format: z.string().describe("Talk, panel, workshop or paper, matching what the call asks for"),
  abstract: z.string().describe("Within the call's word limit if one is published"),
  learning_objectives: z.array(z.string()),
  speaker_bios: z.array(z.object({ speaker: z.string(), bio: z.string() })),
  submission_notes: z.string().describe("What else the form asks for and anything we must decide or supply"),
});

/** Drafts a proposal for one conference's call for papers, ready for a person to polish and submit. */
export async function draftAbstract(db, conferenceId, { angle = "" } = {}) {
  const brand = loadBrand();
  const c = db.prepare("SELECT * FROM conferences WHERE id = ?").get(conferenceId);
  if (!c) throw new Error(`No conference ${conferenceId}`);
  const speakers = parseJson(c.speakers).map((id) => entityById(brand, id)?.name ?? id);

  const p = await ask({
    system: systemPrompt(brand),
    webSearch: 4,
    effort: "high",
    schema: AbstractSchema,
    prompt: `Draft a proposal for ${c.name} ${c.edition} (${c.cfp_url ?? c.url ?? "find the call for papers"}).
Read the call for papers first: match its tracks, themes, format and word limits.
Speakers: ${speakers.join(", ") || "choose from the brand profile"}.
Why we fit: ${c.fit}
${angle ? `Angle requested by the team: ${angle}` : ""}
Bios may only use facts from the brand profile; leave a clearly marked [TODO] where a fact is missing.`,
  });

  const text = `# ${p.title}\n_${p.format}_\n\n${p.abstract}\n\n## Learning objectives\n${p.learning_objectives.map((o) => `- ${o}`).join("\n")}\n\n## Speakers\n${p.speaker_bios.map((b) => `**${b.speaker}**: ${b.bio}`).join("\n\n")}\n\n## Before submitting\n${p.submission_notes}`;
  db.prepare("UPDATE conferences SET abstract = ?, status = CASE WHEN status = 'watching' THEN 'applying' ELSE status END, updated_at = datetime('now') WHERE id = ?")
    .run(text, conferenceId);
  return { conferenceId, title: p.title };
}

export { daysUntil };
