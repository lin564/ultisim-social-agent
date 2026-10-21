import { createHmac, randomBytes } from "node:crypto";
import { request, cred } from "./http.js";

// X API v2, signed with OAuth 1.0a user context: the four values from the app's "Keys and tokens" page in the
// X developer console (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET). They don't expire.
// The access token must be generated after the app's permissions are set to "Read and write".
// X bills per request, so mention checks ask only for mentions newer than the last one seen.
const API = "https://api.x.com/2";

const KEYS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
const keys = (account) => Object.fromEntries(KEYS.map((k) => [k, cred(k, account)]));

// RFC 3986 encoding, as OAuth 1.0a requires.
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The OAuth 1.0a Authorization header for a request. Query parameters (and form fields, when given) are signed;
 * a JSON body is not, per the spec. `nonce` and `timestamp` are only passed in tests.
 */
export function oauthHeader(method, url, k, { form = {}, nonce, timestamp } = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: k.X_API_KEY,
    oauth_nonce: nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: k.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const params = [...u.searchParams, ...Object.entries(form), ...Object.entries(oauth)]
    .map(([key, value]) => [pct(key), pct(value)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(params)].join("&");
  const signature = createHmac("sha1", `${pct(k.X_API_SECRET)}&${pct(k.X_ACCESS_TOKEN_SECRET)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: signature })
    .map(([key, value]) => `${pct(key)}="${pct(value)}"`)
    .join(", ");
}

const signed = (method, url, account) => ({ Authorization: oauthHeader(method, url, keys(account)) });

// The access token starts with the account's numeric user id ("12345-abc..."), so X_USER_ID is optional.
const userId = (account) => cred("X_USER_ID", account) || cred("X_ACCESS_TOKEN", account)?.split("-")[0];

export default {
  name: "x",
  configured: (account) => KEYS.every((k) => cred(k, account)),

  async publish(draft) {
    const body = { text: draft.text };
    if (draft.kind === "reply") body.reply = { in_reply_to_tweet_id: draft.target };
    const url = `${API}/tweets`;
    const { data } = await request("x", url, { method: "POST", headers: signed("POST", url, draft.account), body });
    const id = data.data.id;
    return { id, url: `https://x.com/i/web/status/${id}` };
  },

  async fetchMentions(account = "ultisim", { sinceId } = {}) {
    const query = new URLSearchParams({
      max_results: "20",
      "tweet.fields": "author_id,created_at",
      expansions: "author_id",
      "user.fields": "username",
    });
    if (sinceId) query.set("since_id", sinceId);
    const url = `${API}/users/${userId(account)}/mentions?${query}`;
    const { data } = await request("x", url, { headers: signed("GET", url, account) });
    const users = Object.fromEntries((data.includes?.users ?? []).map((u) => [u.id, u.username]));
    return (data.data ?? []).map((t) => ({
      external_id: t.id,
      author: users[t.author_id] ?? t.author_id,
      text: t.text,
      url: `https://x.com/i/web/status/${t.id}`,
    }));
  },

  async fetchMetrics(ids, account = "ultisim") {
    if (!ids.length) return {};
    const url = `${API}/tweets?${new URLSearchParams({ ids: ids.slice(0, 100).join(","), "tweet.fields": "public_metrics" })}`;
    const { data } = await request("x", url, { headers: signed("GET", url, account) });
    return Object.fromEntries((data.data ?? []).map((t) => [t.id, {
      impressions: t.public_metrics.impression_count,
      likes: t.public_metrics.like_count,
      comments: t.public_metrics.reply_count,
      shares: t.public_metrics.retweet_count + t.public_metrics.quote_count,
    }]));
  },
};
