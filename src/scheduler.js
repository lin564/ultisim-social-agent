import cron from "node-cron";
import { jobs } from "./jobs/index.js";
import { recordRun } from "./db.js";

// Times are in SCHEDULE_TZ (default America/New_York). Override any line with SCHEDULE_<JOB>, e.g. SCHEDULE_DRAFTS="0 7 * * 1-5".
const DEFAULTS = {
  news: "0 6 * * *",          // daily 6:00
  drafts: "30 6 * * 1,3,5",   // Mon/Wed/Fri 6:30, after the news scan
  publish: "*/10 * * * *",    // every 10 minutes: approved drafts that are due
  mentions: "0 */2 * * *",    // every 2 hours
  reminders: "0 8 * * *",     // daily 8:00
  conferences: "0 5 * * 1",   // Mondays 5:00
  metrics: "0 4 * * *",       // daily 4:00
  report: "0 9 * * 1",        // Mondays 9:00
};

export function startScheduler(db) {
  const timezone = process.env.SCHEDULE_TZ ?? "America/New_York";
  for (const [name, fallback] of Object.entries(DEFAULTS)) {
    const expr = process.env[`SCHEDULE_${name.toUpperCase()}`] ?? fallback;
    if (expr === "off") continue;
    let running = false;
    cron.schedule(expr, async () => {
      if (running) return; // never overlap a slow run with the next tick
      running = true;
      try {
        await recordRun(db, name, () => jobs[name](db));
      } catch (err) {
        console.error(`[${name}]`, err.message);
      } finally {
        running = false;
      }
    }, { timezone });
    console.log(`scheduled ${name}: ${expr} (${timezone})`);
  }
}
