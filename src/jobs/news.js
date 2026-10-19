import { z } from "zod";
import { ask } from "../claude.js";
import { loadBrand, systemPrompt, searchTerms } from "../brand.js";
import { json } from "../db.js";

const NewsSchema = z.object({
  items: z.array(z.object({
    url: z.string(),
    title: z.string(),
    summary: z.string().describe("Two or three sentences: what happened and why it matters to us."),
    entity_ids: z.array(z.string()).describe("Brand profile entity ids this item is about, empty if it is field news"),
    published_at: z.string().nullable().describe("YYYY-MM-DD if known"),
  })),
});

/** Finds recent news about our companies, people and products, and big news in our fields. */
export async function scanNews(db, { days = 7 } = {}) {
  const brand = loadBrand();
  const known = db.prepare("SELECT url FROM news ORDER BY id DESC LIMIT 200").all().map((r) => r.url);
  const today = new Date().toISOString().slice(0, 10);

  const { items } = await ask({
    system: systemPrompt(brand),
    webSearch: 8,
    schema: NewsSchema,
    prompt: `Today is ${today}. Search the web for news from the last ${days} days:
1. Anything about: ${searchTerms(brand).join(", ")}. Watch for people with the same names; only keep items that are clearly about ours.
2. The most important developments in our fields (${brand.conferences.fields.join("; ")}) that our experts could comment on credibly. At most 5 of these.

Skip anything already known: ${JSON.stringify(known)}
Only include items with a real URL you actually found.`,
  });

  const insert = db.prepare(`INSERT OR IGNORE INTO news (url, title, summary, entity_ids, published_at) VALUES (?, ?, ?, ?, ?)`);
  let added = 0;
  for (const n of items) added += insert.run(n.url, n.title, n.summary, json(n.entity_ids), n.published_at).changes;
  return { found: items.length, added };
}
