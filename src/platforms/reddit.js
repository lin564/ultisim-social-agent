import { request } from "./http.js";

// Reddit "script" app with the posting account's own username and password.
let cached = { token: null, expires: 0 };
const userAgent = () => process.env.REDDIT_USER_AGENT ?? "ultisim-social-agent/0.1";

async function token() {
  if (cached.token && Date.now() < cached.expires) return cached.token;
  const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64");
  const { data } = await request("reddit", "https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "User-Agent": userAgent() },
    form: { grant_type: "password", username: process.env.REDDIT_USERNAME, password: process.env.REDDIT_PASSWORD },
  });
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

const headers = async () => ({ Authorization: `Bearer ${await token()}`, "User-Agent": userAgent() });

export default {
  name: "reddit",
  configured: (account) => account === "ultisim" && Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_USERNAME),

  async publish(draft) {
    const form = draft.kind === "reply"
      ? { thing_id: draft.target, text: draft.text, api_type: "json" }
      : { sr: draft.target, kind: "self", title: draft.title ?? draft.text.slice(0, 280), text: draft.text, api_type: "json" };
    if (draft.kind !== "reply" && !draft.target) throw new Error("Reddit posts need a subreddit in the draft's target field");
    const endpoint = draft.kind === "reply" ? "comment" : "submit";
    const { data } = await request("reddit", `https://oauth.reddit.com/api/${endpoint}`, { method: "POST", headers: await headers(), form });
    if (data.json?.errors?.length) throw new Error(`reddit: ${JSON.stringify(data.json.errors)}`);
    const thing = data.json.data.things?.[0]?.data ?? data.json.data;
    return { id: thing.name ?? thing.id, url: thing.url ?? (thing.permalink ? `https://www.reddit.com${thing.permalink}` : null) };
  },

  async fetchMentions() {
    // Replies and username mentions in the account's inbox.
    const { data } = await request("reddit", "https://oauth.reddit.com/message/inbox?limit=50", { headers: await headers() });
    return (data.data?.children ?? [])
      .filter((c) => c.kind === "t1")
      .map(({ data: m }) => ({ external_id: m.name, author: m.author, text: m.body, url: `https://www.reddit.com${m.context}` }));
  },
};
