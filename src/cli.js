// Run one job by hand: npm run job -- drafts
import { openDb, recordRun } from "./db.js";
import { jobs, draftAbstract } from "./jobs/index.js";

const [name, arg] = process.argv.slice(2);
const db = openDb();

if (name === "abstract") {
  console.log(await recordRun(db, "abstract", () => draftAbstract(db, Number(arg))));
} else if (jobs[name]) {
  console.log(await recordRun(db, name, () => jobs[name](db)));
} else {
  console.error(`Usage: npm run job -- <${Object.keys(jobs).join("|")}|abstract <conference id>>`);
  process.exit(1);
}
