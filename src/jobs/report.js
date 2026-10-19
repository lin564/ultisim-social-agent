import { z } from "zod";
import { ask } from "../claude.js";
import { loadBrand, systemPrompt } from "../brand.js";
import { platforms } from "../platforms/index.js";
import { notify, dashboardLink } from "../notify.js";

/** Snapshots engagement for posts from the last 30 days, where the platform exposes it. */
export async function collectMetrics(db) {
  const posts = db.prepare(`SELECT id, platform, account, external_id FROM drafts
    WHERE status = 'published' AND external_id IS NOT NULL AND updated_at > datetime('now', '-30 days')`).all();
  const insert = db.prepare("INSERT INTO metrics (draft_id, impressions, likes, comments, shares, clicks) VALUES (?, ?, ?, ?, ?, ?)");
  const groups = Map.groupBy(posts, (p) => `${p.platform}|${p.account}`);
  let captured = 0;
  const errors = [];
  for (const [key, group] of groups) {
    const [name, account] = key.split("|");
    const platform = platforms[name];
    if (!platform.fetchMetrics) continue;
    try {
      const stats = await platform.fetchMetrics(group.map((p) => p.external_id), account);
      for (const p of group) {
        const s = stats[p.external_id];
        if (!s) continue;
        insert.run(p.id, s.impressions ?? null, s.likes ?? null, s.comments ?? null, s.shares ?? null, s.clicks ?? null);
        captured++;
      }
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { captured, errors };
}

const ReportSchema = z.object({
  headline: z.string(),
  what_worked: z.array(z.string()),
  what_did_not: z.array(z.string()),
  next_week: z.array(z.string()).describe("Concrete changes to try"),
  conference_status: z.string(),
});

/** Weekly performance report: what went out, how it did, what to change, and where we stand on calls for papers. */
export async function weeklyReport(db, { days = 7 } = {}) {
  const posts = db.prepare(`SELECT d.id, d.platform, d.account, d.pillar, substr(d.text, 1, 280) AS text, d.external_url, d.updated_at AS published,
      m.impressions, m.likes, m.comments, m.shares
    FROM drafts d LEFT JOIN metrics m ON m.id = (SELECT max(id) FROM metrics WHERE draft_id = d.id)
    WHERE d.status = 'published' AND d.updated_at > datetime('now', ?)`).all(`-${days} days`);
  const pipeline = db.prepare("SELECT status, count(*) AS n FROM drafts WHERE created_at > datetime('now', ?) GROUP BY status").all(`-${days} days`);
  const confs = db.prepare(`SELECT name, edition, cfp_deadline, status FROM conferences
    WHERE status NOT IN ('skipped') AND (cfp_deadline IS NULL OR cfp_deadline >= date('now', '-30 days')) ORDER BY cfp_deadline`).all();

  const r = await ask({
    system: systemPrompt(loadBrand()),
    schema: ReportSchema,
    prompt: `Write the weekly social media report for the last ${days} days. Be candid and specific; small numbers are fine, say what they suggest. Metrics are missing for platforms that don't expose them; say so rather than guessing.

Published posts with latest metrics: ${JSON.stringify(posts)}
Draft pipeline: ${JSON.stringify(pipeline)}
Conferences: ${JSON.stringify(confs)}`,
  });

  const body = `*${r.headline}*\n\n*What worked*\n${r.what_worked.map((x) => `• ${x}`).join("\n")}\n\n*What didn't*\n${r.what_did_not.map((x) => `• ${x}`).join("\n")}\n\n*Next week*\n${r.next_week.map((x) => `• ${x}`).join("\n")}\n\n*Conferences*\n${r.conference_status}`;
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  db.prepare("INSERT INTO reports (period_start, period_end, body) VALUES (?, ?, ?)").run(start, end, body);
  await notify(`Weekly social report\n${body}\n${dashboardLink("#reports")}`);
  return { posts: posts.length };
}
