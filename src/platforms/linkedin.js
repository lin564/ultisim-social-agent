import { request, cred } from "./http.js";
import { loadBrand, entityById } from "../brand.js";

// LinkedIn Posts API.
// Company pages: a page admin's token with w_organization_social (Community Management API) and, per page,
//   LINKEDIN_AUTHOR (UltiSim) or LINKEDIN_AUTHOR_<ENTITY> (e.g. _QUESTSIM) set to the page's organization id
//   (the number in linkedin.com/company/<id>/admin) or urn:li:organization:<id>. One admin token posts to every
//   page that admin manages, so other company pages share UltiSim's token unless given their own.
//   With LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET and LINKEDIN_REFRESH_TOKEN the access token renews itself.
// A person's own profile: a token with w_member_social plus openid and profile in LINKEDIN_ACCESS_TOKEN_<ENTITY>.
//   Their author URN is looked up from the token, so LINKEDIN_AUTHOR_<ENTITY> is optional.
const API = "https://api.linkedin.com";
const tokens = new Map();   // refresh token -> { token, expires }
const authors = new Map();  // account -> looked-up person URN

const isPerson = (account) => entityById(loadBrand(), account)?.type === "person";
// A person always uses their own credentials; a company page falls back to the shared admin credentials.
const tokenCred = (key, account) => cred(key, account) || (isPerson(account) ? undefined : process.env[key]);
const canRefresh = (account) =>
  Boolean(tokenCred("LINKEDIN_REFRESH_TOKEN", account) && tokenCred("LINKEDIN_CLIENT_ID", account) && tokenCred("LINKEDIN_CLIENT_SECRET", account));

async function accessToken(account) {
  if (!canRefresh(account)) return tokenCred("LINKEDIN_ACCESS_TOKEN", account);
  const refreshToken = tokenCred("LINKEDIN_REFRESH_TOKEN", account);
  const cached = tokens.get(refreshToken);
  if (cached && Date.now() < cached.expires) return cached.token;
  const { data } = await request("linkedin", "https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    form: {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: tokenCred("LINKEDIN_CLIENT_ID", account),
      client_secret: tokenCred("LINKEDIN_CLIENT_SECRET", account),
    },
  });
  tokens.set(refreshToken, { token: data.access_token, expires: Date.now() + (data.expires_in - 3600) * 1000 });
  return data.access_token;
}

async function author(account, token) {
  const configured = cred("LINKEDIN_AUTHOR", account);
  if (configured) return /^\d+$/.test(configured) ? `urn:li:${isPerson(account) ? "person" : "organization"}:${configured}` : configured;
  if (!authors.has(account)) {
    const { data } = await request("linkedin", `${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
    authors.set(account, `urn:li:person:${data.sub}`);
  }
  return authors.get(account);
}

export default {
  name: "linkedin",
  configured: (account) =>
    Boolean((tokenCred("LINKEDIN_ACCESS_TOKEN", account) || canRefresh(account)) && (cred("LINKEDIN_AUTHOR", account) || isPerson(account))),

  async publish(draft) {
    if (draft.kind === "reply") throw new Error("LinkedIn replies need the Community Management API; reply by hand for now");
    const token = await accessToken(draft.account);
    let res;
    try {
      ({ headers: res } = await request("linkedin", `${API}/rest/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": process.env.LINKEDIN_VERSION ?? "202609",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: {
          author: await author(draft.account, token),
          commentary: draft.text,
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        },
      }));
    } catch (err) {
      if (/-> 401/.test(err.message)) {
        throw new Error(`The LinkedIn token for "${draft.account}" has expired or was revoked. Generate a new one (docs/SETUP.md, LinkedIn) and update it in Render.`);
      }
      throw err;
    }
    const id = res.get("x-restli-id");
    return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null };
  },
};
