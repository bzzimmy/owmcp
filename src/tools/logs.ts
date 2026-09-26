import { basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fit, save, text, truncate } from "../output.js";
import { parseRegex } from "../regex.js";
import { lastExecute, latestLogFile, LOG_DIR, readLog, type Level, type LogEntry } from "../robloxLog.js";

const DESCRIPTION = `Read the Roblox client console (print/warn/error from all scripts, including the game's own), newest last.
- Debug loop: after \`execute\`, call with sinceExecute=true to see everything logged since that run started (deferred errors, spawned loops), or new=true for everything since the previous logs call.
- Errors from code run via execute are tagged "mcp:<line>"; from the Opiumware editor "Opiumware:<line>". Filter with grep.
- Repeated consecutive lines are collapsed to (xN). Long messages are truncated; when anything is cut, the full results are saved to a temp file you can grep.`;

interface Group {
  entry: LogEntry;
  count: number;
}

// Cursor for new=true: how many entries of which file the previous call had seen.
let cursor: { file: string; count: number } | undefined;

export function registerLogs(server: McpServer) {
  server.registerTool(
    "logs",
    {
      title: "Read console logs",
      description: DESCRIPTION,
      inputSchema: {
        level: z
          .array(z.enum(["print", "warn", "error", "engine"]))
          .default(["print", "warn", "error"])
          .describe('Levels to include. "engine" adds Roblox engine channels (assets, network, ...), usually noise.'),
        grep: z.string().optional().describe("Case-insensitive regex matched against message and stack."),
        new: z.boolean().default(false).describe("Only entries logged since the previous logs call."),
        sinceExecute: z.boolean().default(false).describe("Only entries logged since the most recent execute call started."),
        seconds: z.number().positive().optional().describe("Only entries from the last N seconds."),
        limit: z.number().int().min(1).max(500).default(30).describe("Max entries shown (newest)."),
      },
    },
    async ({ level, grep, new: onlyNew, sinceExecute, seconds, limit }) => {
      const file = await latestLogFile();
      if (!file) return text(`No Roblox log files found in ${LOG_DIR}.`, true);

      const pattern = parseRegex(grep);
      if (pattern instanceof Error) return text(`Invalid grep regex: ${pattern.message}`, true);

      const entries = await readLog(file);
      const previous = cursor;
      cursor = { file, count: entries.length };
      const start = onlyNew && previous?.file === file ? previous.count : 0;

      const levels = new Set<Level>(level);
      const since = Math.max(
        seconds === undefined ? 0 : Date.now() - seconds * 1000,
        sinceExecute ? (lastExecute.at ?? 0) : 0,
      );
      const matched = entries
        .slice(start)
        .filter(
          (entry) =>
            levels.has(entry.level) &&
            entry.time.getTime() >= since &&
            (!pattern || pattern.test(`${entry.channel} ${entry.message} ${entry.stack.join(" ")}`)),
        );

      const header = [`Log: ${basename(file)} (session started ${clock(entries[0]?.time)})`];
      if (onlyNew && previous && previous.file !== file) header.push("Note: new log file since the previous call (Roblox rejoined).");
      if (onlyNew && !previous) header.push("Note: no previous logs call, so showing from the session start.");
      if (sinceExecute && lastExecute.at === undefined) header.push("Note: no execute call yet, so sinceExecute has no effect.");

      if (matched.length === 0) {
        header.push(onlyNew && previous ? "No new matching entries since the previous logs call." : "No matching entries.");
        return text(header.join("\n"));
      }

      const groups = collapse(matched);
      const shown = groups.slice(-limit);
      const lines = shown.map((group) => formatGroup(group, true));
      const truncated = lines.some((line, i) => line !== formatGroup(shown[i] as Group, false));

      header.push(summarize(matched, groups.length, shown.length));
      if (shown.length < groups.length || truncated) {
        const full = save("logs", groups.map((group) => formatGroup(group, false)).join("\n"));
        header.push(`Full untruncated results: ${full}`);
      }

      return text(fit("logs", [...header, "", ...lines].join("\n")));
    },
  );
}

/** Merges consecutive identical entries. */
function collapse(entries: LogEntry[]): Group[] {
  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (
      last &&
      last.entry.level === entry.level &&
      last.entry.message === entry.message &&
      last.entry.stack.join() === entry.stack.join()
    ) {
      last.count++;
    } else {
      groups.push({ entry, count: 1 });
    }
  }
  return groups;
}

function summarize(matched: LogEntry[], groupCount: number, shownCount: number): string {
  const counts = new Map<Level, number>();
  for (const entry of matched) counts.set(entry.level, (counts.get(entry.level) ?? 0) + 1);
  const breakdown = (["error", "warn", "print", "engine"] as const)
    .filter((level) => counts.has(level))
    .map((level) => `${level} ${counts.get(level) ?? 0}`)
    .join(", ");

  const collapsed = matched.length - groupCount;
  return [
    `${matched.length} matching entries (${breakdown})`,
    collapsed > 0 ? `${groupCount} lines after collapsing repeats` : undefined,
    shownCount < groupCount ? `showing newest ${shownCount} lines` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatGroup({ entry, count }: Group, compact: boolean): string {
  let message = entry.level === "engine" ? `[${entry.channel.replace(/^D?FLog::/, "")}] ${entry.message}` : entry.message;
  if (compact) message = truncate(message.replaceAll("\n", " ⏎ "));
  const stack = entry.stack.length > 0 ? `  (at ${entry.stack.join(" < ")})` : "";
  const repeat = count > 1 ? `  (x${count})` : "";
  return `${clock(entry.time)} ${entry.level.padEnd(6)} ${message}${stack}${repeat}`;
}

/** Local HH:MM:SS. */
function clock(time: Date | undefined): string {
  return time ? time.toTimeString().slice(0, 8) : "?";
}
