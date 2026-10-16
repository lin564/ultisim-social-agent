/** Small fetch wrapper: JSON in, JSON out, and errors that say which platform failed and why. */
export async function request(platform, url, { method = "GET", headers = {}, body, form } = {}) {
  const init = { method, headers: { ...headers } };
  if (form) {
    init.body = new URLSearchParams(form);
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${platform} ${method} ${new URL(url).pathname} -> ${res.status}: ${text.slice(0, 500)}`);
  return { data: text ? safeJson(text) : null, headers: res.headers };
}

const safeJson = (t) => { try { return JSON.parse(t); } catch { return t; } };

/**
 * Credentials for the company account live in KEY; a person's own account in KEY_<ENTITY>,
 * e.g. LINKEDIN_ACCESS_TOKEN_RICHARD_BOYD for account "richard-boyd".
 */
export function cred(key, account = "ultisim") {
  if (account === "ultisim") return process.env[key];
  return process.env[`${key}_${account.toUpperCase().replaceAll("-", "_")}`];
}
