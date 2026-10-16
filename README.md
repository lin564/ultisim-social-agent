# UltiSim Social Agent

UltiSim's in-house social media manager. It keeps UltiSim, QuestSim, HealthSimAI, Richard Boyd, Linda Bernard and Bob Kleinhample visible as experts in their fields, and keeps them on the conference circuit. Claude does the research and writing, and a person approves everything before it goes out.

## What it does

| Job | When (default, `SCHEDULE_TZ`) | What happens |
|---|---|---|
| `news` | Daily 6:00 | Searches the web for news about our companies, people and products, plus major news in our fields. |
| `drafts` | Mon/Wed/Fri 6:30 | Writes a batch of posts across the content pillars for every platform that has credentials. Posts can react to fresh news, and each one includes a rationale and its sources. |
| `publish` | Every 10 min | Publishes **approved** drafts that are due. It never publishes anything else. |
| `mentions` | Every 2 h | Pulls mentions and comments from X, Facebook and Reddit, then triages them. It drafts a reply, ignores spam, or escalates to a person (complaints, press, sales leads). |
| `conferences` | Mondays 5:00 | Finds conferences where Richard, Linda and Bob should present, with call-for-papers deadlines taken from the official sites. |
| `reminders` | Daily 8:00 | Sends a Slack reminder 30, 14, 7, 3 and 1 days before each proposal deadline we haven't submitted to. Deadlines that pass are marked missed. |
| `metrics` | Daily 4:00 | Snapshots engagement on recent posts where the platform's API exposes it (X, Facebook). |
| `report` | Mondays 9:00 | Writes a weekly report: what went out, how it did, what to change, and where each call for papers stands. |

The dashboard (`/`) is where the team works:
- **Drafts**: edit, schedule, approve, reject, or publish now. The character count follows each platform's limit.
- **Conferences**: track each call through watching → applying → submitted → accepted. Press "Draft proposal" and Claude reads the call for papers and drafts the title, abstract, learning objectives and bios for you to polish.
- **Escalations**: mentions that need a person.
- **Reports** and **System**: platform connection status, run-a-job buttons, and the run log.

### Guardrails
- Nothing is published without a person's approval. Replies go through the same queue as posts.
- `config/brand.json` is the source of truth. Claude may only state facts about our companies and people that appear there or in a source it cites. Fields marked `TODO` are treated as unknown.
- Shooting content stays educational and safety-minded. No politics and no comment on shootings in the news.

## Setup

1. **Fill in `config/brand.json`.** This matters more than any other step. Replace every `TODO` with descriptions, verified facts, products and handles for UltiSim, QuestSim, HealthSimAI, Richard, Linda and Bob. The agent's output is only as specific as this file. The file is re-read on every run, so you can edit it at any time.
2. `cp .env.example .env`, then set `ANTHROPIC_API_KEY`, `DASHBOARD_PASSWORD` and `SLACK_WEBHOOK_URL`.
3. Add credentials for each platform you want (see below). Platforms without credentials are skipped. Drafting still works with no platform connected.
4. `npm ci && npm start`, then open http://localhost:8787 (any username, your `DASHBOARD_PASSWORD`).

Run any job by hand: `npm run job -- conferences`, `npm run job -- drafts`, `npm run job -- abstract 3`.

Tests: `npm test`. Needs Node 22.13 or later; the database is the built-in `node:sqlite`.

### Platform credentials

Credentials for the company account use the plain variable names. For Richard's or Linda's own accounts, add their entity id to the name, for example `LINKEDIN_ACCESS_TOKEN_RICHARD_BOYD` and `LINKEDIN_AUTHOR_RICHARD_BOYD=urn:li:person:...`. Drafts written in their voice are then published from their accounts.

| Platform | You need | Notes |
|---|---|---|
| X | A developer app on a tier that allows posting; an OAuth 2.0 user token (`tweet.read tweet.write users.read`) | `X_USER_ID` turns on mention checks. |
| LinkedIn | An app with the Community Management API; a token with `w_organization_social` for the company page | Replies to LinkedIn comments are not automated yet; handle them on LinkedIn. |
| Facebook / Instagram | A Meta app; a Page access token; an Instagram professional account linked to the Page | Instagram posts need an image URL on the draft. |
| Reddit | A "script" app plus the posting account's login | Set the subreddit on each draft. Follow each subreddit's self-promotion rules. |
| Discord | A channel webhook URL | Publishing only. |

Tokens expire: X and LinkedIn tokens need refreshing, and Meta Page tokens should be long-lived. A failed publish shows its error on the draft and sends a Slack message.

## Deploying

A single small always-on process with a persistent disk for the SQLite file. With the included `Dockerfile`, any container host works (Fly.io, Render, Railway, a VM): mount a volume at `/data` and set the variables from `.env.example` as secrets. To run jobs from an external scheduler instead, set `SCHEDULER=off` and call `npm run job -- <name>`.

Put the dashboard behind HTTPS, because it uses Basic auth.

## Costs

Every job that calls Claude uses `claude-opus-5-5` (`CLAUDE_MODEL` overrides it), plus web search on the research jobs. With the default schedule, expect a few dozen calls a week. The system prompt is cached across calls.

## Layout

```
config/brand.json        source of truth: entities, voice, pillars, platforms, conference targets
src/claude.js            structured Claude calls with web search
src/jobs/                news, drafts, mentions, conferences (+reminders, proposals), publish, report (+metrics)
src/platforms/           X, LinkedIn, Facebook, Instagram, Reddit, Discord adapters
src/server.js            dashboard API and Basic auth; starts the scheduler
src/scheduler.js         cron schedule (overridable per job)
public/index.html        the dashboard
```
