import { scanNews } from "./news.js";
import { draftPosts } from "./drafts.js";
import { scoutConferences, remindDeadlines, draftAbstract } from "./conferences.js";
import { checkMentions } from "./mentions.js";
import { publishDue } from "./publish.js";
import { collectMetrics, weeklyReport } from "./report.js";

/** Every job by name, for the scheduler, the CLI and the dashboard's "run now" buttons. */
export const jobs = {
  news: scanNews,
  drafts: draftPosts,
  conferences: scoutConferences,
  reminders: remindDeadlines,
  mentions: checkMentions,
  publish: publishDue,
  metrics: collectMetrics,
  report: weeklyReport,
};

export { draftAbstract };
