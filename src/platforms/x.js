import { request, cred } from "./http.js";

// X API v2 with an OAuth 2.0 user-context token (scopes: tweet.read tweet.write users.read).
const API = "https://api.x.com/2";
const auth = (account) => ({ Authorization: `Bearer ${cred("X_ACCESS_TOKEN", account)}` });

export default {
  name: "x",
  configured: (account) => Boolean(cred("X_ACCESS_TOKEN", account)),

  async publish(draft) {
    const body = { text: draft.text };
    if (draft.kind === "reply") body.reply = { in_reply_to_tweet_id: draft.target };
    const { data } = await request("x", `${API}/tweets`, { method: "POST", headers: auth(draft.account), body });
    const id = data.data.id;
    return { id, url: `https://x.com/i/web/status/${id}` };
  },

  async fetchMentions(account = "ultisim") {
    const userId = cred("X_USER_ID", account);
    if (!userId) return [];
    const url = `${API}/users/${userId}/mentions?max_results=50&tweet.fields=author_id,created_at&expansions=author_id&user.fields=username`;
    const { data } = await request("x", url, { headers: auth(account) });
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
    const url = `${API}/tweets?ids=${ids.slice(0, 100).join(",")}&tweet.fields=public_metrics`;
    const { data } = await request("x", url, { headers: auth(account) });
    return Object.fromEntries((data.data ?? []).map((t) => [t.id, {
      impressions: t.public_metrics.impression_count,
      likes: t.public_metrics.like_count,
      comments: t.public_metrics.reply_count,
      shares: t.public_metrics.retweet_count + t.public_metrics.quote_count,
    }]));
  },
};
