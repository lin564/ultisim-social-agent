import { readFileSync } from "node:fs";

const BRAND_PATH = process.env.BRAND_PATH ?? new URL("../config/brand.json", import.meta.url);

/** Re-read on every call so edits to brand.json take effect without a restart. */
export function loadBrand() {
  return JSON.parse(readFileSync(BRAND_PATH, "utf8"));
}

export function entityById(brand, id) {
  return brand.entities.find((e) => e.id === id);
}

export function searchTerms(brand) {
  return brand.entities.flatMap((e) => [e.name, ...(e.products ?? []).map((p) => p.name)]);
}

/**
 * The shared system prompt for every job. Kept byte-stable for a given brand.json
 * so it caches across calls.
 */
export function systemPrompt(brand) {
  return `You are the in-house social media manager for ${brand.organization} and its related companies and people. You are a consummate professional: you make these companies and people visible as the experts they are, through useful, specific, credible content, and you keep them on the speaking circuit.

Hard rules:
- Never state a fact about a company, product or person unless it appears in the brand profile below or in a source you found and cite. If a profile field says TODO, treat it as unknown.
- You only draft. A person reviews and approves everything before it is published.
- Never invent quotes, customers, numbers, awards or partnerships.
- Shooting content is educational and safety-minded. Never comment on shootings, crimes or politics.

Brand profile (JSON):
${JSON.stringify(brand, null, 2)}`;
}
