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

LinkedIn treats personal profiles and company pages differently:

| | Personal profiles (Richard, Linda, Bob) | UltiSim company page |
|---|---|---|
| LinkedIn product | **Share on LinkedIn**: self-serve, available immediately | **Community Management API**: you apply, and LinkedIn reviews |
| Token life | 60 days, then generate a new one | Renews itself once approved |
| Who signs in | Each person, with their own LinkedIn login | A page admin |

Each person approves the drafts written in their own voice before they go out.

### 5a. Personal profiles (about 20 min, plus 5 min per person)

1. Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → **Create app**.
   - **App name:** `UltiSim Social Desk – Profiles`.
   - **LinkedIn Page:** UltiSim.
   - Add the logo and a privacy policy URL, and accept the terms.
2. On the app's **Settings** tab, click **Verify** and send the link to an UltiSim page admin, or open it yourself if you're an admin.
3. On the **Products** tab, request **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both are granted straight away.
4. On the **Auth** tab, under **Authorized redirect URLs**, add `https://www.linkedin.com/developers/tools/oauth/redirect`. The token tool in the next step needs it.
5. Each person does this on their own computer, logged in to **their own** LinkedIn account:
   - Open the [OAuth token generator](https://www.linkedin.com/developers/tools/oauth/token-generator) and pick the app.
   - Tick `openid`, `profile` and `w_member_social`, then click **Request access token** and allow.
   - Copy the token straight into Render (**Environment** tab) under their name:
     - `LINKEDIN_ACCESS_TOKEN_RICHARD_BOYD`
     - `LINKEDIN_ACCESS_TOKEN_LINDA_BERNARD`
     - `LINKEDIN_ACCESS_TOKEN_BOB_KLEINHAMPLE`
6. Save. Render restarts, and **System** shows linkedin as connected.

These tokens expire after 60 days. Put a reminder in each person's calendar to repeat step 5. If a token runs out first, the next publish fails with a message saying which person's token to renew.

### 5b. Company page (apply now; approval takes days to weeks)

1. Create a **second** app the same way: `UltiSim Social Desk – Page`, with LinkedIn Page set to UltiSim. LinkedIn wants the Community Management API on an app of its own.
2. On **Products**, choose **Community Management API → Request access** and fill in the form. Use the legal company name, ultisim.com and an @ultisim.com email. For the use-case question, paste the text below.
3. LinkedIn grants a **Development tier** first, then **Standard** after review.
4. Once access is granted:
   - Open the token generator again and pick this app. Tick `w_organization_social` and `r_organization_social`, then generate a token as a page admin.
   - Set these in Render:
     - `LINKEDIN_ACCESS_TOKEN`: the token.
     - `LINKEDIN_REFRESH_TOKEN`: the refresh token, if the tool shows one.
     - `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`: from the app's **Auth** tab.
     - `LINKEDIN_AUTHOR`: the number in the address when you manage the page, `linkedin.com/company/<number>/admin`.
   - With the refresh token set, the agent renews its own access.

Use-case text for the access form:

> UltiSim Inc. is a simulation and AI company in Chapel Hill, North Carolina. We are building an internal tool that helps our small marketing team publish to our own LinkedIn company page. A staff member reviews and approves every post in our tool before it is published through the Posts API with w_organization_social. We read our own page's post statistics (r_organization_social) for a weekly internal report. We manage only our own organization's page. We do not access member data, and we do not offer this tool to third parties.
