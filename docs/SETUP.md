# Going live: Slack, Facebook and Render

About an hour, in this order. Keep the values you collect somewhere private (a password manager), not in email or chat. You'll paste them into Render in step 4.

## 1. Claude API key (5 min)

1. Go to [console.anthropic.com](https://console.anthropic.com), sign in with the company account, and set up billing under **Plans & Billing** if it isn't already.
2. **API Keys → Create Key**. Name it `social-agent`.
3. Copy the key (it starts with `sk-ant-`). This is `ANTHROPIC_API_KEY`.

## 2. Slack channel for notifications (5 min)

1. In Slack, create a channel for the agent, for example `#social-desk`, and invite whoever reviews posts.
2. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From scratch**. Name it `Social Desk` and pick your workspace.
3. Open **Incoming Webhooks**, switch it **On**, then click **Add New Webhook to Workspace** and choose `#social-desk`.
4. Copy the webhook URL (it starts with `https://hooks.slack.com/services/`). This is `SLACK_WEBHOOK_URL`.

## 3. Facebook Page tokens (20–30 min)

Do this as a person who is an admin of both the UltiSim and QuestSim Facebook Pages.

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**. Choose the use case for managing a Facebook Page (Pages API), link it to the company's Business portfolio if asked, and name it `UltiSim Social Desk`.
2. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/). Pick the new app in the **Meta App** menu, then **Get User Access Token**. Tick these permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `pages_read_user_content`, so the agent can read comments
   - `pages_manage_engagement`, so approved replies can be posted

   When Facebook asks which Pages to allow, select both **UltiSim** and **QuestSim**.
3. Copy the token from the Explorer and paste it into the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/). Click **Extend Access Token** and copy the long-lived token it gives you.
4. Back in the Graph API Explorer, paste the long-lived token into the token box. Run a GET on:
   ```
   me/accounts?fields=id,name,access_token
   ```
   You get one entry per Page. Page tokens made from a long-lived token don't expire.
   - The **UltiSim** entry: `id` is `META_PAGE_ID` and `access_token` is `META_PAGE_ACCESS_TOKEN`.
   - The **QuestSim** entry: `id` is `META_PAGE_ID_QUESTSIM` and `access_token` is `META_PAGE_ACCESS_TOKEN_QUESTSIM`.

If a test post shows up only for you and not for the public, the app is still in Development mode. Switch it to **Live** in the app dashboard. Meta may ask for business verification first.

## 4. Deploy on Render (15 min)

1. Merge the pull request into `main`. Render deploys from `main`.
2. Sign in to [render.com](https://render.com) with GitHub and allow Render to read `lin564/ultisim-social-agent`.
3. **New → Blueprint**, pick the repository, and Render reads `render.yaml`. It creates one web service on the Starter plan with a 1 GB disk for the database.
4. Fill in the values it asks for:
   - `ANTHROPIC_API_KEY` from step 1.
   - `DASHBOARD_PASSWORD`: choose a long one and share it only with the reviewers.
   - `SLACK_WEBHOOK_URL` from step 2.
   - The four `META_…` values from step 3.
5. Click **Apply** and wait for the first deploy to go green.
6. Open the service's `.onrender.com` URL. Sign in with any username and the dashboard password.
7. Go to **System**. Both Facebook rows should say **connected**. Press **news**, wait a minute, then **drafts**. Drafts appear under **Drafts** and Slack gets a message.
8. Approve one draft with **Publish now** and check that it appears on the Page.

After that the scheduler runs on its own (times are US Eastern):

| What | When |
|---|---|
| News scan | daily |
| Drafts | Monday, Wednesday and Friday mornings |
| Conference search | Mondays |
| Deadline reminders | daily |
| Weekly report | Monday 9:00 |

To change anything later, such as adding a platform, a token or a schedule, edit the service's **Environment** tab in Render. Saving restarts the service.

## 5. LinkedIn

The agent posts to the **UltiSim** and **QuestSim** company pages. Personal profiles for Richard, Linda and Bob are an optional extra.

| | Company pages (UltiSim, QuestSim) | Personal profiles (optional) |
|---|---|---|
| LinkedIn product | **Community Management API**: you apply once and LinkedIn reviews it, usually within days to weeks | **Share on LinkedIn**: self-serve, available immediately |
| Token | One page admin's token covers both pages, and it renews itself | Each person makes their own and renews it every 60 days |

### 5a. Company pages: apply now

1. Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → **Create app**.
   - **App name:** `UltiSim Social Desk`.
   - **LinkedIn Page:** UltiSim.
   - Add the logo and a privacy policy URL, and accept the terms.
2. On the app's **Settings** tab, click **Verify** and approve it as an UltiSim page admin, or send the link to one.
3. On the **Products** tab, choose **Community Management API → Request access** and fill in the form:
   - Use the legal company name, ultisim.com and an @ultisim.com email.
   - For the use-case question, paste the text at the end of this section.

   LinkedIn wants this API on an app with no other products, so don't add any here.
4. On the **Auth** tab, under **Authorized redirect URLs**, add `https://www.linkedin.com/developers/tools/oauth/redirect`.
5. **Wait for approval.** LinkedIn grants a Development tier first, then Standard. Until then, keep posting to LinkedIn by hand from the approved drafts.
6. Once approved, sign in to LinkedIn as someone who is an **admin of both the UltiSim and QuestSim pages**:
   - Open the [OAuth token generator](https://www.linkedin.com/developers/tools/oauth/token-generator) and pick the app.
   - Tick `w_organization_social` and `r_organization_social`, then click **Request access token** and allow.
7. In Render (**Environment** tab), add:
   - `LINKEDIN_ACCESS_TOKEN`: the token.
   - `LINKEDIN_REFRESH_TOKEN`: the refresh token, if the tool shows one.
   - `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`: from the app's **Auth** tab.
   - `LINKEDIN_AUTHOR`: UltiSim's page number. While managing the page, the address is `linkedin.com/company/<number>/admin`.
   - `LINKEDIN_AUTHOR_QUESTSIM`: QuestSim's page number, found the same way.

QuestSim uses the same token as UltiSim, so it needs only its page number. With the refresh token set, the agent renews its own access. Save, and **System** shows linkedin as connected.

Use-case text for the access form:

> UltiSim Inc. is a simulation and AI company in Chapel Hill, North Carolina. We are building an internal tool that helps our small marketing team publish to our own LinkedIn company pages, UltiSim and QuestSim. A staff member reviews and approves every post in our tool before it is published through the Posts API with w_organization_social. We read our own pages' post statistics (r_organization_social) for a weekly internal report. We manage only our own organizations' pages. We do not access member data, and we do not offer this tool to third parties.

### 5b. Personal profiles (optional)

Posts from Richard's, Linda's or Bob's own profile usually reach more people than company posts. Each person approves the drafts written in their voice.

1. Create a **separate** app, `UltiSim Social Desk – Profiles`, the same way as in 5a, steps 1, 2 and 4.
2. On its **Products** tab, add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both are granted straight away.
3. Each person, logged in to **their own** LinkedIn account:
   - Opens the token generator and picks this app.
   - Ticks `openid`, `profile` and `w_member_social`, and generates a token.
   - Pastes it into Render as `LINKEDIN_ACCESS_TOKEN_RICHARD_BOYD`, `LINKEDIN_ACCESS_TOKEN_LINDA_BERNARD` or `LINKEDIN_ACCESS_TOKEN_BOB_KLEINHAMPLE`.
4. These tokens last 60 days. Put a reminder in each person's calendar to repeat step 3. If a token runs out first, the next publish fails with a message saying whose token to renew.

## 6. X

X's API is billed per request from credits you buy in advance. At a few posts a week it typically costs a few dollars a month; posts that contain a link cost more.

1. Sign in to [developer.x.com](https://developer.x.com) **as the UltiSim X account**, and sign up for developer access. For the use-case description, say plainly what the tool does:
   - posts our own content after a person approves it;
   - reads mentions of our account so we can reply, with AI-suggested replies that a person approves;
   - reads our own posts' public metrics for an internal report;
   - doesn't resell data, train models on it, or share it with anyone.
2. Buy a small amount of credit, e.g. $10–20, and turn off auto-recharge or set a low cap.
3. Open your app and go to **User authentication settings → Edit**:
   - **App permissions:** Read and write.
   - **Type of app:** Web App, Automated App or Bot.
   - **Callback URL and Website URL:** `https://ultisim.com`.

   Save.
4. Go to **Keys and tokens**:
   - Regenerate the **API Key and Secret**.
   - Generate the **Access Token and Secret**. The panel should say **Read and Write**; if it says Read only, regenerate it.
5. In Render (**Environment** tab), add `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET`, and save.

These keys don't expire. If you ever regenerate them in the X console, update Render too.

