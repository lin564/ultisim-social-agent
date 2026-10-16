import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { openDb, updateDraft, recordRun, parseJson } from "./db.js";
import { jobs, draftAbstract } from "./jobs/index.js";
import { publishDue } from "./jobs/publish.js";
import { platforms } from "./platforms/index.js";
import { startScheduler } from "./scheduler.js";

const PAGE = new URL("../public/index.html", import.meta.url);
const DRAFT_EDITABLE = ["text", "title", "target", "image_url", "scheduled_for", "platform", "account"];
const CONF_EDITABLE = ["status", "notes", "cfp_deadline", "cfp_url", "abstract", "speakers"];
const CONF_STATUSES = ["watching", "applying", "submitted", "accepted", "declined", "skipped", "missed"];

function authorized(req) {
  const password = process.env.DASHBOARD_PASSWORD;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const [, given = ""] = Buffer.from(header.slice(6), "base64").toString().split(/:(.*)/s);
  const a = Buffer.from(given), b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

function state(db) {
  return {
    drafts: db.prepare(`SELECT * FROM drafts WHERE status IN ('pending','approved','failed')
      OR (status = 'published' AND updated_at > datetime('now','-14 days')) ORDER BY id DESC LIMIT 200`).all()
      .map((d) => ({ ...d, sources: parseJson(d.sources) })),
    conferences: db.prepare(`SELECT * FROM conferences ORDER BY
      CASE status WHEN 'applying' THEN 0 WHEN 'watching' THEN 1 WHEN 'submitted' THEN 2 WHEN 'accepted' THEN 3 ELSE 4 END,
      cfp_deadline IS NULL, cfp_deadline`).all().map((c) => ({ ...c, speakers: parseJson(c.speakers) })),
    escalations: db.prepare("SELECT * FROM mentions WHERE status = 'escalated' ORDER BY id DESC LIMIT 50").all(),
    reports: db.prepare("SELECT * FROM reports ORDER BY id DESC LIMIT 6").all(),
    runs: db.prepare("SELECT id, job, started_at, finished_at, ok, substr(detail, 1, 400) AS detail FROM runs ORDER BY id DESC LIMIT 25").all(),
    platforms: Object.fromEntries(Object.entries(platforms).map(([n, p]) => [n, p.configured("ultisim")])),
    jobs: Object.keys(jobs),
  };
}

function runInBackground(db, name, fn) {
  recordRun(db, name, fn).catch((err) => console.error(`[${name}]`, err.message));
}

export function createApp(db) {
  return createServer(async (req, res) => {
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    if (!authorized(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="social-agent"' });
      return res.end();
    }
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/") return send(200, readFileSync(PAGE), "text/html; charset=utf-8");
      if (req.method === "GET" && path === "/api/state") return send(200, state(db));
      if (req.method !== "POST") return send(404, { error: "Not found" });

      const body = await readBody(req);
      let m;

      if ((m = path.match(/^\/api\/drafts\/(\d+)$/))) {
        const id = Number(m[1]);
        const fields = pick(body, DRAFT_EDITABLE);
        if (body.action === "approve") fields.status = "approved";
        if (body.action === "reject") fields.status = "rejected";
        if (body.action === "reopen") Object.assign(fields, { status: "pending", error: null });
        updateDraft(db, id, fields);
        return send(200, { ok: true });
      }
      if ((m = path.match(/^\/api\/drafts\/(\d+)\/publish$/))) {
        const id = Number(m[1]);
        updateDraft(db, id, { status: "approved", scheduled_for: null });
        return send(200, await recordRun(db, "publish", () => publishDue(db, { onlyId: id })));
      }
      if ((m = path.match(/^\/api\/conferences\/(\d+)$/))) {
        const fields = pick(body, CONF_EDITABLE);
        if (fields.status && !CONF_STATUSES.includes(fields.status)) return send(400, { error: "Bad status" });
        if (fields.speakers) fields.speakers = JSON.stringify(fields.speakers);
        const keys = Object.keys(fields);
        if (keys.length) {
          db.prepare(`UPDATE conferences SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
            .run(...keys.map((k) => fields[k]), Number(m[1]));
        }
        return send(200, { ok: true });
      }
      if ((m = path.match(/^\/api\/conferences\/(\d+)\/abstract$/))) {
        runInBackground(db, "abstract", () => draftAbstract(db, Number(m[1]), { angle: body.angle ?? "" }));
        return send(202, { started: true });
      }
      if (path === "/api/conferences") {
        if (!body.name || !body.edition) return send(400, { error: "name and edition are required" });
        db.prepare("INSERT INTO conferences (name, edition, url, cfp_url, cfp_deadline, fit) VALUES (?, ?, ?, ?, ?, ?)")
          .run(body.name, String(body.edition), body.url ?? null, body.cfp_url ?? null, body.cfp_deadline ?? null, body.fit ?? "Added by hand");
        return send(200, { ok: true });
      }
      if ((m = path.match(/^\/api\/jobs\/(\w+)$/)) && jobs[m[1]]) {
        runInBackground(db, m[1], () => jobs[m[1]](db));
        return send(202, { started: true });
      }
      return send(404, { error: "Not found" });
    } catch (err) {
      console.error(err);
      return send(500, { error: err.message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.DASHBOARD_PASSWORD) {
    console.error("Set DASHBOARD_PASSWORD before starting the dashboard.");
    process.exit(1);
  }
  const db = openDb();
  if (process.env.SCHEDULER !== "off") startScheduler(db);
  const port = Number(process.env.PORT ?? 8787);
  createApp(db).listen(port, () => console.log(`social-agent dashboard on http://localhost:${port}`));
}
