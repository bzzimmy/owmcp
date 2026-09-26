import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const LOG_DIR = join(homedir(), "Library", "Logs", "Roblox");

export type Level = "print" | "warn" | "error" | "engine";

/** When the execute tool last started a run (for logs sinceExecute). */
export const lastExecute: { at?: number } = {};

export interface LogEntry {
  time: Date;
  level: Level;
  /** Engine channel (e.g. "DFLog::AssetProvider"), only meaningful for level "engine". */
  channel: string;
  message: string;
  /** Stack frames as "Script:Line", innermost first. */
  stack: string[];
}

// 2026-09-26T22:48:37.616Z,3431.616943,6caff000,6,Error [FLog::CreatorError] Error: ...
// 2026-09-26T22:54:43.322Z,3797.322266,6d7c7000,12 [DFLog::HttpTraceError] ...   (severity and channel are optional)
const ENTRY = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z),[^,]*,[^,]*,\d+(?:,\w+)? ?(?:\[([^\]]+)\] ?)?(.*)$/;
const STACK_FRAME = /^\s*Script '(.+)', Line (\d+)/;
const STACK_MARKER = /^\s*Stack (Begin|End)\s*$/;

// The developer console channels; everything else is engine noise.
const SCRIPT_CHANNELS: Record<string, Level> = {
  "FLog::CreatorOutput": "print",
  "FLog::CreatorWarning": "warn",
  "FLog::CreatorError": "error",
};

/** Newest log file = the current (or most recent) Roblox session. */
export async function latestLogFile(): Promise<string | undefined> {
  const names = (await readdir(LOG_DIR).catch(() => [])).filter((name) => name.endsWith(".log"));
  const files = await Promise.all(
    names.map(async (name) => {
      const path = join(LOG_DIR, name);
      return { path, mtime: (await stat(path)).mtimeMs };
    }),
  );
  return files.sort((a, b) => b.mtime - a.mtime)[0]?.path;
}

/** Parses a log file into entries, joining multi-line messages and stack traces onto their entry. */
export async function readLog(path: string): Promise<LogEntry[]> {
  const entries: LogEntry[] = [];

  for (const line of (await readFile(path, "utf8")).split("\n")) {
    const match = ENTRY.exec(line);
    if (match) {
      const [, time = "", channel = "", message = ""] = match;
      const level = SCRIPT_CHANNELS[channel] ?? "engine";
      entries.push({
        time: new Date(time),
        level,
        channel,
        message: level === "engine" ? message : message.replace(/^(Error|Warning): /, ""),
        stack: [],
      });
      continue;
    }

    const last = entries.at(-1);
    if (!last || line.trim() === "" || STACK_MARKER.test(line)) continue;
    const frame = STACK_FRAME.exec(line);
    if (frame) last.stack.push(`${frame[1] ?? "?"}:${frame[2] ?? "?"}`);
    else last.message += "\n" + line;
  }

  return entries;
}
