import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INLINE_LIMIT = 6_000;
const PREVIEW_LENGTH = 1_500;
export const OUTPUT_DIR = join(tmpdir(), "owmcp");

/** Returns text as-is if small, otherwise saves it to a temp file and returns the path + a preview. */
export function fit(name: string, text: string): string {
  if (text.length <= INLINE_LIMIT) return text;

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = join(OUTPUT_DIR, `${name}-${Date.now()}.txt`);
  writeFileSync(file, text);

  const lines = text.split("\n").length;
  return [
    `Output too large (${text.length} chars, ${lines} lines). Full output saved to: ${file}`,
    `Use grep/read on that file. Preview:`,
    "",
    text.slice(0, PREVIEW_LENGTH),
    "...",
  ].join("\n");
}

/** MCP tool result helper. */
export function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}
