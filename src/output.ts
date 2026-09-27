import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INLINE_LIMIT = 6_000;
const PREVIEW_LENGTH = 1_500;
const MAX_LINE = 300;
export const OUTPUT_DIR = join(tmpdir(), "owmcp");

/** A fresh path in the temp output folder, e.g. tempPath("screenshot", "png"). */
export function tempPath(name: string, extension: string): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  return join(OUTPUT_DIR, `${name}-${Date.now()}.${extension}`);
}

/** Saves text to a temp file and returns its path. */
export function save(name: string, text: string): string {
  const file = tempPath(name, "txt");
  writeFileSync(file, text);
  return file;
}

/** Returns text as-is if small, otherwise saves it to a temp file and returns the path + a preview. */
export function fit(name: string, text: string): string {
  if (text.length <= INLINE_LIMIT) return text;

  const file = save(name, text);
  const lines = text.split("\n").length;
  return [
    `Output too large (${text.length} chars, ${lines} lines). Full output saved to: ${file}`,
    `Use grep/read on that file. Preview:`,
    "",
    text.slice(0, PREVIEW_LENGTH),
    "...",
  ].join("\n");
}

/** Shortens a single line for inline display. */
export function truncate(line: string, max = MAX_LINE): string {
  return line.length > max ? `${line.slice(0, max)}… (+${line.length - max} chars)` : line;
}

/** Collapses consecutive duplicate lines into "line  (xN)" and truncates long lines. */
export function compactLines(lines: string[]): { lines: string[]; truncated: boolean } {
  const groups: { line: string; count: number }[] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    if (last?.line === line) last.count++;
    else groups.push({ line, count: 1 });
  }
  let truncated = false;
  const compact = groups.map(({ line, count }) => {
    const flat = line.replaceAll("\n", " ⏎ ");
    const short = truncate(flat);
    if (short !== flat) truncated = true;
    return count > 1 ? `${short}  (x${count})` : short;
  });
  return { lines: compact, truncated };
}

/** MCP tool result helper. */
export function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}
