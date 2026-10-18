import { z } from "zod";
import { ask } from "../claude.js";
import { loadBrand, systemPrompt } from "../brand.js";
import { platforms, connectedAccounts } from "../platforms/index.js";
import { notify, dashboardLink } from "../notify.js";

const TriageSchema = z.object({
  decisions: z.array(z.object({
    mention_id: z.number(),
    action: z.enum(["reply", "ignore", "escalate"]).describe("escalate: needs a person (complaint, press, legal, sales lead, anything sensitive)"),
    reply: z.string().nullable(),
    reason: z.string(),
  })),
});

/** Pulls new mentions and comments, and drafts replies for review. Nothing is sent without approval. */
export async function checkMentions(db) {
  const brand = loadBrand();
  const insert = db.prepare("INSERT OR IGNORE INTO mentions (platform, account, external_id, author, text, url) VALUES (?, ?, ?, ?, ?, ?)");
  const errors = [];
  for (const { platform, account } of connectedAccounts(brand)) {
    const p = platforms[platform];
    if (!p.fetchMentions) continue;
    try {
      for (const m of await p.fetchMentions(account)) insert.run(platform, account, m.external_id, m.author, m.text, m.url);
    } catch (err) {
      errors.push(err.message);
    }
  }

  const fresh = db.prepare("SELECT id, platform, account, external_id, author, text, url FROM mentions WHERE status = 'new' ORDER BY id LIMIT 40").all();
  if (!fresh.length) return { triaged: 0, errors };

  const { decisions } = await ask({
    system: systemPrompt(brand),
    schema: TriageSchema,
    prompt: `Triage these new mentions and comments on our accounts. Reply when a short, gracious, useful reply helps (thanks, answering a question, adding expertise). Ignore spam and bots. Escalate anything a person should handle. Replies must fit the platform's limits.

${JSON.stringify(fresh.map(({ external_id, ...m }) => m), null, 1)}`,
  });

  const byId = new Map(fresh.map((m) => [m.id, m]));
  const addReply = db.prepare(`INSERT INTO drafts (kind, platform, account, text, target, rationale, sources) VALUES ('reply', ?, ?, ?, ?, ?, ?)`);
  const setStatus = db.prepare("UPDATE mentions SET status = ? WHERE id = ?");
  const escalations = [];
  for (const d of decisions) {
    const m = byId.get(d.mention_id);
    if (!m) continue;
    if (d.action === "reply" && d.reply) {
      addReply.run(m.platform, m.account, d.reply, m.external_id, `Reply to @${m.author}: "${m.text.slice(0, 200)}"\n${d.reason}`, JSON.stringify([m.url].filter(Boolean)));
      setStatus.run("drafted", m.id);
    } else {
      setStatus.run(d.action === "escalate" ? "escalated" : "ignored", m.id);
      if (d.action === "escalate") escalations.push(`• ${m.platform} (${m.account}) @${m.author}: ${d.reason} ${m.url ?? ""}`);
    }
  }
  if (escalations.length) await notify(`Mentions that need a person:\n${escalations.join("\n")}`);
  const replies = decisions.filter((d) => d.action === "reply").length;
  if (replies) await notify(`${replies} reply draft${replies === 1 ? "" : "s"} waiting for review. ${dashboardLink("#drafts")}`);
  return { triaged: decisions.length, replies, escalated: escalations.length, errors };
}
