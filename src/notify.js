/**
 * Sends a message to the team. Uses a Slack incoming webhook when SLACK_WEBHOOK_URL is set,
 * and always logs, so nothing is lost when no channel is configured.
 */
export async function notify(text) {
  console.log(`[notify] ${text}`);
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) console.error(`[notify] Slack webhook failed: ${res.status} ${await res.text()}`);
}

// Render sets RENDER_EXTERNAL_URL itself, so links work there without configuring PUBLIC_URL.
export const dashboardLink = (path = "") => {
  const base = process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL;
  return base ? `${base.replace(/\/$/, "")}/${path}` : "";
};
