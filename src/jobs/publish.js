import { platforms } from "../platforms/index.js";
import { updateDraft } from "../db.js";
import { notify } from "../notify.js";

/** Publishes approved drafts that are due. Only drafts a person approved are ever sent. */
export async function publishDue(db, { onlyId } = {}) {
  const due = onlyId
    ? db.prepare("SELECT * FROM drafts WHERE id = ? AND status = 'approved'").all(onlyId)
    : db.prepare("SELECT * FROM drafts WHERE status = 'approved' AND (scheduled_for IS NULL OR scheduled_for <= datetime('now')) ORDER BY id").all();
  const results = [];
  for (const draft of due) {
    const platform = platforms[draft.platform];
    if (!platform?.configured(draft.account)) {
      updateDraft(db, draft.id, { status: "failed", error: `No ${draft.platform} credentials for account "${draft.account}"` });
      results.push({ id: draft.id, ok: false });
      continue;
    }
    try {
      const { id, url } = await platform.publish(draft);
      updateDraft(db, draft.id, { status: "published", external_id: id, external_url: url, error: null });
      results.push({ id: draft.id, ok: true, url });
    } catch (err) {
      updateDraft(db, draft.id, { status: "failed", error: err.message });
      results.push({ id: draft.id, ok: false });
      await notify(`Publishing draft #${draft.id} to ${draft.platform} failed: ${err.message}`);
    }
  }
  return { attempted: results.length, published: results.filter((r) => r.ok).length, results };
}
