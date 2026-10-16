import { request, cred } from "./http.js";

// Meta Graph API. Facebook: a Page access token. Instagram: a Business/Creator account linked to that Page.
const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
const token = (account) => cred("META_PAGE_ACCESS_TOKEN", account);

export const facebook = {
  name: "facebook",
  configured: (account) => Boolean(token(account) && cred("META_PAGE_ID", account)),

  async publish(draft) {
    const path = draft.kind === "reply" ? `${draft.target}/comments` : `${cred("META_PAGE_ID", draft.account)}/feed`;
    const { data } = await request("facebook", `${graph()}/${path}`, {
      method: "POST",
      form: { message: draft.text, access_token: token(draft.account) },
    });
    return { id: data.id, url: `https://www.facebook.com/${data.id}` };
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
    const out = {};
    for (const id of ids) {
      const url = `${graph()}/${id}?fields=reactions.summary(total_count),comments.summary(total_count),shares&access_token=${token(account)}`;
      const { data } = await request("facebook", url);
      out[id] = {
        likes: data.reactions?.summary?.total_count ?? 0,
        comments: data.comments?.summary?.total_count ?? 0,
        shares: data.shares?.count ?? 0,
      };
    }
    return out;
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
};
