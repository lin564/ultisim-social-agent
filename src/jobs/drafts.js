import { z } from "zod";
import { ask } from "../claude.js";
import { loadBrand, systemPrompt } from "../brand.js";
import { json } from "../db.js";
import { PLATFORM_NAMES, connectedAccounts } from "../platforms/index.js";
import { notify, dashboardLink } from "../notify.js";

const DraftSchema = z.object({
  drafts: z.array(z.object({
    platform: z.enum(PLATFORM_NAMES),
    account: z.string().describe("Entity id of the account it is posted from: the company, or a person posting as themselves"),
    pillar: z.string(),
    text: z.string(),
    title: z.string().nullable().describe("Reddit post title; null elsewhere"),
    target: z.string().nullable().describe("Subreddit name without r/ for Reddit; null elsewhere"),
    image_idea: z.string().nullable().describe("For Instagram, or wherever an image would help: what the image should show"),
    rationale: z.string().describe("One sentence for the reviewer: why this post, why now"),
    sources: z.array(z.string()).describe("URLs backing any claim in the post"),
  })),
});

/**
 * Writes a batch of drafts for review, for the accounts that have credentials so drafts land
 * where they can actually be published. With nothing connected yet, it drafts for LinkedIn and X
 * for the team to post by hand.
 */
export async function draftPosts(db, { count = 6 } = {}) {
  const brand = loadBrand();
  const live = connectedAccounts(brand);
  const targets = live.length
    ? live.map((a) => `${a.platform} as ${a.account}`).join(", ")
    : "linkedin and x, from any account in the brand profile (nothing is connected yet; the team posts these by hand)";
  const today = new Date().toISOString().slice(0, 10);

  const news = db.prepare("SELECT id, url, title, summary, entity_ids FROM news WHERE used = 0 ORDER BY id DESC LIMIT 15").all();
  const recent = db.prepare("SELECT platform, pillar, text FROM drafts WHERE kind = 'post' AND created_at > datetime('now', '-30 days') ORDER BY id DESC LIMIT 40").all();
  const conferences = db.prepare("SELECT name, edition, event_start, location, status FROM conferences WHERE status IN ('submitted','accepted') AND (event_start IS NULL OR event_start >= date('now'))").all();

  const { drafts } = await ask({
    system: systemPrompt(brand),
    webSearch: 3,
    effort: "high",
    schema: DraftSchema,
    prompt: `Today is ${today}. Write ${count} social posts for review, spread across these platform/account pairs and no others: ${targets}.

Balance the content pillars by their weights, and don't repeat the angles of recent posts. Make each post something a peer would save or share: a specific lesson, a clear opinion, a useful explainer. Posts from a person's account are written in that person's first-person voice and are only for people listed in the brand profile. Respect each platform's maxChars and style.

Fresh news you may react to (cite the URL in sources if you use it):
${JSON.stringify(news.map(({ id, ...n }) => n), null, 1)}

Our upcoming confirmed talks and submissions:
${JSON.stringify(conferences)}

Recent posts (avoid repeating):
${JSON.stringify(recent.map((r) => ({ ...r, text: r.text.slice(0, 200) })))}`,
  });

  const insert = db.prepare(`INSERT INTO drafts (kind, platform, account, pillar, text, title, target, rationale, sources)
    VALUES ('post', ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const d of drafts) {
    const rationale = d.image_idea ? `${d.rationale}\nImage idea: ${d.image_idea}` : d.rationale;
    insert.run(d.platform, d.account, d.pillar, d.text, d.title, d.target, rationale, json(d.sources));
  }
  const usedUrls = new Set(drafts.flatMap((d) => d.sources));
  const markUsed = db.prepare("UPDATE news SET used = 1 WHERE id = ?");
  for (const n of news) if (usedUrls.has(n.url)) markUsed.run(n.id);

  if (drafts.length) await notify(`${drafts.length} new post draft${drafts.length === 1 ? " is" : "s are"} waiting for review. ${dashboardLink("#drafts")}`);
  return { drafted: drafts.length };
}
