import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// Images uploaded from the dashboard, kept next to the database on the persistent disk and served at a public,
// unguessable URL so Instagram and Facebook can fetch them when a post is published.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const CONTENT_TYPES = Object.fromEntries(Object.entries(TYPES).map(([type, ext]) => [ext, type]));

const uploadDir = () => process.env.UPLOAD_DIR ?? join(dirname(process.env.DB_PATH ?? "data/social-agent.db"), "uploads");

export function saveUpload(buffer, contentType) {
  const ext = TYPES[contentType];
  if (!ext) throw new Error("Upload a JPEG, PNG or WebP image");
  if (!buffer.length) throw new Error("The image is empty");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error("Images must be 8 MB or smaller");
  mkdirSync(uploadDir(), { recursive: true });
  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  writeFileSync(join(uploadDir(), name), buffer);
  return name;
}

/** The stored file for a public /media/<name> request, or null. Only names this module generates are served. */
export function readUpload(name) {
  const match = /^[a-f0-9]{24}\.(jpg|png|webp)$/.exec(name);
  if (!match) return null;
  const path = join(uploadDir(), name);
  return existsSync(path) ? { body: readFileSync(path), type: CONTENT_TYPES[match[1]] } : null;
}
