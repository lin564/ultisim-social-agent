import { request, cred } from "./http.js";

// LinkedIn Posts API. Company page: token with w_organization_social and LINKEDIN_AUTHOR=urn:li:organization:<id>.
// A person's own profile: token with w_member_social and LINKEDIN_AUTHOR_<ENTITY>=urn:li:person:<id>.
const headers = (account) => ({
  Authorization: `Bearer ${cred("LINKEDIN_ACCESS_TOKEN", account)}`,
  "LinkedIn-Version": process.env.LINKEDIN_VERSION ?? "202609",
  "X-Restli-Protocol-Version": "2.0.0",
});

export default {
  name: "linkedin",
  configured: (account) => Boolean(cred("LINKEDIN_ACCESS_TOKEN", account) && cred("LINKEDIN_AUTHOR", account)),

  async publish(draft) {
    if (draft.kind === "reply") throw new Error("LinkedIn replies need the Community Management API; reply by hand for now");
    const { headers: res } = await request("linkedin", "https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: headers(draft.account),
      body: {
        author: cred("LINKEDIN_AUTHOR", draft.account),
        commentary: draft.text,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
    });
    const id = res.get("x-restli-id");
    return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null };
  },
};
