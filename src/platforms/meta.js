import { request, cred } from "./http.js";

// Meta Graph API. Facebook: a Page access token. Instagram: a Business/Creator account linked to that Page.
const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
const token = (account) => cred("META_PAGE_ACCESS_TOKEN", account);

/**
 * Reads one insights metric for a post or media item, or null when Meta has no value for it. Metrics are asked for
 * one at a time because Meta rejects a whole request over one metric it has retired or that the token can't read.
 * Missing permissions are collected in `denied` so the run log can say which one to add.
 */
async function insight(id, metric, account, denied) {
  try {
    const { data } = await request("meta", `${graph()}/${id}/insights?metric=${metric}&access_token=${token(account)}`);
    const row = data.data?.[0];
    const value = row?.total_value?.value ?? row?.values?.[0]?.value;
    // Some metrics come back split (e.g. organic and paid); add the parts up.
    if (value && typeof value === "object") return Object.values(value).reduce((a, b) => a + (Number(b) || 0), 0);
    return typeof value === "number" ? value : null;
  } catch (err) {
    if (/\(#10\)|\(#200\)|permission/i.test(err.message)) denied.add(metric);
    return null;
  }
}

const deniedWarning = (denied, permission) =>
  denied.size ? `Meta wouldn't share ${[...denied].join(", ")}: add the ${permission} permission to the Page token (docs/SETUP.md, "Post stats")` : null;

export const facebook = {
  name: "facebook",
  configured: (account) => Boolean(token(account) && cred("META_PAGE_ID", account)),

  async publish(draft) {
    const pageId = cred("META_PAGE_ID", draft.account);
    // A post with an image goes up as a photo post, so the picture shows in the feed rather than as a link.
    const withImage = draft.kind !== "reply" && draft.image_url;
    const path = draft.kind === "reply" ? `${draft.target}/comments` : withImage ? `${pageId}/photos` : `${pageId}/feed`;
    const form = { message: draft.text, access_token: token(draft.account) };
    if (withImage) Object.assign(form, { url: draft.image_url, caption: draft.text });
    const { data } = await request("facebook", `${graph()}/${path}`, { method: "POST", form });
    const id = data.post_id ?? data.id;
    return { id, url: `https://www.facebook.com/${id}` };
  },

  async fetchMentions(account = "ultisim") {
    // Recent comments on our recent Page posts.
    const pageId = cred("META_PAGE_ID", account);
    const url = `${graph()}/${pageId}/feed?fields=comments.limit(25){id,from,message,permalink_url}&limit=10&access_token=${token(account)}`;
    const { data } = await request("facebook", url);
    return (data.data ?? []).flatMap((post) => (post.comments?.data ?? [])
      .filter((c) => c.from?.id !== pageId)
      .map((c) => ({ external_id: c.id, author: c.from?.name, text: c.message, url: c.permalink_url })));
  },

  async fetchMetrics(ids, account = "ultisim") {
    const stats = {};
    const denied = new Set();
    for (const id of ids) {
      const url = `${graph()}/${id}?fields=reactions.summary(total_count),comments.summary(total_count),shares&access_token=${token(account)}`;
      const { data } = await request("facebook", url);
      stats[id] = {
        likes: data.reactions?.summary?.total_count ?? 0,
        comments: data.comments?.summary?.total_count ?? 0,
        shares: data.shares?.count ?? 0,
        // Views and reach need the read_insights permission.
        impressions: await insight(id, "post_media_view", account, denied),
        reach: await insight(id, "post_total_media_view_unique", account, denied),
      };
    }
    return { stats, warning: deniedWarning(denied, "read_insights") };
  },
};

export const instagram = {
  name: "instagram",
  configured: (account) => Boolean(token(account) && cred("INSTAGRAM_USER_ID", account)),

  async publish(draft) {
    if (draft.kind === "reply") {
      const { data } = await request("instagram", `${graph()}/${draft.target}/replies`, {
        method: "POST", form: { message: draft.text, access_token: token(draft.account) },
      });
      return { id: data.id, url: null };
    }
    if (!draft.image_url) throw new Error("Instagram posts need an image URL; add one to the draft before approving");
    const igUser = cred("INSTAGRAM_USER_ID", draft.account);
    const { data: container } = await request("instagram", `${graph()}/${igUser}/media`, {
      method: "POST", form: { image_url: draft.image_url, caption: draft.text, access_token: token(draft.account) },
    });
    const { data } = await request("instagram", `${graph()}/${igUser}/media_publish`, {
      method: "POST", form: { creation_id: container.id, access_token: token(draft.account) },
    });
    const { data: media } = await request("instagram", `${graph()}/${data.id}?fields=permalink&access_token=${token(draft.account)}`);
    return { id: data.id, url: media.permalink };
  },

  async fetchMetrics(ids, account = "ultisim") {
    const stats = {};
    const denied = new Set();
    for (const id of ids) {
      const { data } = await request("instagram", `${graph()}/${id}?fields=like_count,comments_count&access_token=${token(account)}`);
      stats[id] = {
        likes: data.like_count ?? 0,
        comments: data.comments_count ?? 0,
        // Views, reach, saves and shares need the instagram_manage_insights permission.
        impressions: await insight(id, "views", account, denied),
        reach: await insight(id, "reach", account, denied),
        saves: await insight(id, "saved", account, denied),
        shares: await insight(id, "shares", account, denied),
      };
    }
    return { stats, warning: deniedWarning(denied, "instagram_manage_insights") };
  },
};
