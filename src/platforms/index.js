import x from "./x.js";
import linkedin from "./linkedin.js";
import { facebook, instagram } from "./meta.js";
import reddit from "./reddit.js";
import discord from "./discord.js";

export const platforms = { x, linkedin, facebook, instagram, reddit, discord };
export const PLATFORM_NAMES = Object.keys(platforms);

/** Every platform/account pair that has credentials, e.g. facebook for "ultisim" and for "questsim". */
export function connectedAccounts(brand) {
  return PLATFORM_NAMES.flatMap((platform) => brand.entities
    .filter((e) => platforms[platform].configured(e.id))
    .map((e) => ({ platform, account: e.id })));
}
