import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  entity_ids TEXT NOT NULL DEFAULT '[]',
  published_at TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  found_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Everything that could go out in our name: posts and replies alike.
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'post',          -- post | reply
  platform TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT 'ultisim',    -- entity id whose account it is for
  pillar TEXT,
  text TEXT NOT NULL,
  title TEXT,                                 -- reddit title
  target TEXT,                                -- subreddit, or the id being replied to
  image_url TEXT,
  rationale TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | published | failed
  scheduled_for TEXT,
  external_id TEXT,
  external_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  author TEXT,
  text TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'new',          -- new | drafted | ignored | escalated
  found_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, external_id)
);

CREATE TABLE IF NOT EXISTS conferences (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  edition TEXT NOT NULL,                       -- e.g. "2027"
  url TEXT,
  cfp_url TEXT,
  location TEXT,
  event_start TEXT,
  event_end TEXT,
  cfp_deadline TEXT,                           -- YYYY-MM-DD, null if not announced
  fit TEXT,
  speakers TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'watching',     -- watching | applying | submitted | accepted | declined | skipped | missed
  abstract TEXT,
  notes TEXT,
  last_reminded_days INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, edition)
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY,
  draft_id INTEGER NOT NULL REFERENCES drafts(id),
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  impressions INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, clicks INTEGER
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  ok INTEGER,
  detail TEXT
);
`;

export function openDb(path = process.env.DB_PATH ?? "data/social-agent.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export const json = (v) => JSON.stringify(v ?? []);
export const parseJson = (s, fallback = []) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

export function updateDraft(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE drafts SET ${set}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
}

/** Wraps a job so every run is logged, and failures are recorded rather than thrown away. */
export async function recordRun(db, job, fn) {
  const { lastInsertRowid: id } = db.prepare("INSERT INTO runs (job) VALUES (?)").run(job);
  try {
    const detail = await fn();
    db.prepare("UPDATE runs SET finished_at = datetime('now'), ok = 1, detail = ? WHERE id = ?")
      .run(JSON.stringify(detail ?? null), id);
    return detail;
  } catch (err) {
    db.prepare("UPDATE runs SET finished_at = datetime('now'), ok = 0, detail = ? WHERE id = ?")
      .run(String(err?.stack ?? err), id);
    throw err;
  }
}
