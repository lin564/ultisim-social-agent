import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { remindDeadlines, daysUntil } from "../src/jobs/conferences.js";
import { publishDue } from "../src/jobs/publish.js";
import { createApp } from "../src/server.js";
import { connectedAccounts } from "../src/platforms/index.js";
import { loadBrand } from "../src/brand.js";

delete process.env.SLACK_WEBHOOK_URL;

function addConference(db, deadline, status = "watching") {
  return db.prepare("INSERT INTO conferences (name, edition, cfp_deadline, fit, status) VALUES (?, '2027', ?, 'fit', ?)")
    .run(`Conf ${Math.random()}`, deadline, status).lastInsertRowid;
}

test("daysUntil counts calendar days, 0 on the deadline day", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  assert.equal(daysUntil("2026-10-16", now), 0);
  assert.equal(daysUntil("2026-10-23", now), 7);
  assert.equal(daysUntil("2026-10-15", now), -1);
});

test("reminders fire once per threshold and mark passed deadlines as missed", async () => {
  const db = openDb(":memory:");
  const now = new Date("2026-10-16T12:00:00Z");
  const soon = addConference(db, "2026-10-21");   // 6 days out -> 7-day reminder
  const passed = addConference(db, "2026-10-01");
  const done = addConference(db, "2026-10-20", "submitted");

  assert.equal((await remindDeadlines(db, { now })).reminded, 1);
  assert.equal((await remindDeadlines(db, { now })).reminded, 0, "no repeat at the same threshold");
  const later = new Date("2026-10-19T12:00:00Z");      // 3 days out -> 3-day reminder
  assert.equal((await remindDeadlines(db, { now: later })).reminded, 1);

  const status = (id) => db.prepare("SELECT status FROM conferences WHERE id = ?").get(id).status;
  assert.equal(status(passed), "missed");
  assert.equal(status(done), "submitted");
  assert.equal(status(soon), "watching");
});

test("publishing only sends approved drafts and records the result", async () => {
  const db = openDb(":memory:");
  const add = db.prepare("INSERT INTO drafts (platform, text, status) VALUES ('x', ?, ?)");
  const approved = add.run("approved post", "approved").lastInsertRowid;
  add.run("pending post", "pending");

  process.env.X_ACCESS_TOKEN = "test-token";
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ data: { id: "123" } }), { status: 201 });
  };
  try {
    const r = await publishDue(db);
    assert.equal(r.published, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.text, "approved post");
    const row = db.prepare("SELECT status, external_id FROM drafts WHERE id = ?").get(approved);
    assert.deepEqual({ ...row }, { status: "published", external_id: "123" });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.X_ACCESS_TOKEN;
  }
});

test("publishing without credentials fails the draft instead of sending", async () => {
  const db = openDb(":memory:");
  const id = db.prepare("INSERT INTO drafts (platform, text, status) VALUES ('linkedin', 'hi', 'approved')").run().lastInsertRowid;
  await publishDue(db);
  const row = db.prepare("SELECT status, error FROM drafts WHERE id = ?").get(id);
  assert.equal(row.status, "failed");
  assert.match(row.error, /No linkedin credentials/);
});

test("dashboard requires the password and edits drafts", async () => {
  process.env.DASHBOARD_PASSWORD = "s3cret";
  const db = openDb(":memory:");
  const id = db.prepare("INSERT INTO drafts (platform, text) VALUES ('x', 'old')").run().lastInsertRowid;
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const auth = { Authorization: `Basic ${Buffer.from("team:s3cret").toString("base64")}` };
  try {
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    assert.equal((await fetch(`${base}/api/state`, { headers: { Authorization: `Basic ${Buffer.from("team:wrong").toString("base64")}` } })).status, 401);

    const res = await fetch(`${base}/api/drafts/${id}`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", text: "new", status: "published" }),
    });
    assert.equal(res.status, 200);
    const row = db.prepare("SELECT text, status FROM drafts WHERE id = ?").get(id);
    assert.deepEqual({ ...row }, { text: "new", status: "approved" }, "status only changes through actions");

    const state = await (await fetch(`${base}/api/state`, { headers: auth })).json();
    assert.equal(state.drafts.length, 1);
  } finally {
    server.close();
  }
});

test("each Facebook page with its own credentials counts as a connected account", () => {
  process.env.META_PAGE_ACCESS_TOKEN = "t1";
  process.env.META_PAGE_ID = "1";
  process.env.META_PAGE_ACCESS_TOKEN_QUESTSIM = "t2";
  process.env.META_PAGE_ID_QUESTSIM = "2";
  try {
    const fb = connectedAccounts(loadBrand()).filter((a) => a.platform === "facebook").map((a) => a.account);
    assert.deepEqual(fb, ["ultisim", "questsim"]);
  } finally {
    for (const k of ["META_PAGE_ACCESS_TOKEN", "META_PAGE_ID", "META_PAGE_ACCESS_TOKEN_QUESTSIM", "META_PAGE_ID_QUESTSIM"]) delete process.env[k];
  }
});

test("the health check answers without the dashboard password", async () => {
  process.env.DASHBOARD_PASSWORD = "s3cret";
  const server = createApp(openDb(":memory:")).listen(0);
  try {
    const res = await fetch(`http://localhost:${server.address().port}/healthz`);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});
