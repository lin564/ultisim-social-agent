import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

let client;
const getClient = () => (client ??= new Anthropic());

/**
 * One structured call to Claude, optionally with live web search.
 * Returns the parsed object, validated against `schema` (a zod schema).
 */
export async function ask({ system, prompt, schema, webSearch = 0, effort = "medium" }) {
  const tools = webSearch
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: webSearch }]
    : undefined;
  const messages = [{ role: "user", content: prompt }];
  const { type, schema: jsonSchema } = betaZodOutputFormat(schema);
  const format = { type, schema: jsonSchema };

  // Server-side web search can pause a long turn; resume it until Claude finishes.
  for (let turn = 0; turn < 6; turn++) {
    // Streamed so long research turns don't hit the SDK's request timeout.
    const response = await getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools,
      output_config: { effort, format },
    }).finalMessage();

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason === "refusal") {
      throw new Error(`Claude declined: ${response.stop_details?.explanation ?? "no reason given"}`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("Claude's answer was cut off at max_tokens");
    }
    // The JSON answer is the text after the last search result; citations can split it across blocks.
    const lastSearch = response.content.findLastIndex((b) => b.type.endsWith("_tool_result"));
    const answer = response.content.slice(lastSearch + 1).filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = schema.safeParse(safeJson(answer));
    if (!parsed.success) throw new Error(`Claude's answer did not match the expected schema: ${parsed.error.message}`);
    return parsed.data;
  }
  throw new Error("Claude kept pausing; gave up after 6 turns");
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
