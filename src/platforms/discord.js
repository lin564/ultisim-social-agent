import { request } from "./http.js";

// A channel webhook; Discord has no read access this way, so publishing only.
export default {
  name: "discord",
  configured: (account) => account === "ultisim" && Boolean(process.env.DISCORD_WEBHOOK_URL),

  async publish(draft) {
    if (draft.kind === "reply") throw new Error("Discord replies are not supported through a webhook");
    const { data } = await request("discord", `${process.env.DISCORD_WEBHOOK_URL}?wait=true`, {
      method: "POST", body: { content: draft.text },
    });
    return { id: data.id, url: null };
  },
};
