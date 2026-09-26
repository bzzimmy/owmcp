import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runData } from "../bridge.js";
import { fit, save, text, truncate } from "../output.js";
import { parseRegex } from "../regex.js";

const LUA = readFileSync(new URL("../../lua/network.luau", import.meta.url), "utf8");
const MAX_SUMMARY = 30;

const DESCRIPTION = `Capture remote traffic between the client and server: outgoing FireServer/InvokeServer (with InvokeServer return values and the calling script) and incoming OnClientEvent.
- start: begin a fresh capture. stop: stop recording (the log is kept). read: view the log (works while running).
- read without \`remote\` gives a per-remote summary (count + latest args); with \`remote\` it lists individual calls with arguments.
- Calls made by your own executed code are marked [by executor].
- Long results are truncated and the full log is saved to a temp file.`;

interface Entry {
  time: number;
  direction: "in" | "out";
  method: string;
  remote: string;
  args: string;
  returned?: string;
  caller?: string;
}

interface Capture {
  started: boolean;
  capturing: boolean;
  elapsed: number;
  dropped: number;
  count: number;
  log?: Entry[];
}

export function registerNetwork(server: McpServer) {
  server.registerTool(
    "network",
    {
      title: "Capture remote traffic",
      description: DESCRIPTION,
      inputSchema: {
        action: z.enum(["start", "stop", "read"]),
        remote: z.string().optional().describe("read: case-insensitive regex on remote path/method; lists matching calls."),
        exclude: z.string().optional().describe("read: case-insensitive regex of remotes to hide (e.g. noisy ones)."),
        limit: z.number().int().min(1).max(500).default(20).describe("read: max calls shown (newest)."),
        port: z.number().int().optional().describe("Opiumware port (default: first found)."),
      },
    },
    async ({ action, remote, exclude, limit, port }) => {
      const include = parseRegex(remote);
      const hide = parseRegex(exclude);
      if (include instanceof Error || hide instanceof Error) {
        return text(`Invalid regex: ${(include instanceof Error ? include : (hide as Error)).message}`, true);
      }

      const capture = await runData<Capture>(LUA, { action }, { port });
      if (action === "start") return text("Capturing remote traffic. Do the thing in-game (or via execute), then use action=read.");
      if (!capture.started) return text("No capture yet. Use action=start first.", true);
      if (action === "stop") return text(`Stopped. ${capture.count} calls recorded in ${capture.elapsed.toFixed(1)}s; use action=read to view them.`);

      const entries = (capture.log ?? []).filter((entry) => !hide || !hide.test(entry.remote));
      const status = [
        `Capture ${capture.capturing ? "running" : "stopped"} · ${capture.elapsed.toFixed(1)}s · ${capture.count} calls`,
        capture.dropped > 0 ? `${capture.dropped} oldest dropped (buffer full)` : undefined,
        hide ? `${capture.count - entries.length} excluded` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");

      if (entries.length === 0) return text(`${status}\nNo calls recorded${hide ? " (after exclude)" : ""}.`);
      return include ? calls(status, entries, include, limit) : summary(status, entries);
    },
  );
}

/** One line per remote: how often it fired and its latest arguments. */
function summary(status: string, entries: Entry[]) {
  const groups = new Map<string, { entry: Entry; count: number }>();
  for (const entry of entries) {
    const key = `${entry.direction} ${entry.method} ${entry.remote}`;
    const group = groups.get(key);
    if (group) {
      group.count++;
      group.entry = entry;
    } else {
      groups.set(key, { entry, count: 1 });
    }
  }

  const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
  const lines = sorted
    .slice(0, MAX_SUMMARY)
    .map(({ entry, count }) => `${String(count).padStart(5)}  ${entry.direction.padEnd(3)} ${entry.method.padEnd(13)} ${entry.remote}  latest: (${truncate(entry.args, 120)})`);
  if (sorted.length > MAX_SUMMARY) lines.push(`… ${sorted.length - MAX_SUMMARY} more remotes (use remote/exclude to narrow).`);

  return text(
    fit(
      "network",
      [`${status} · ${groups.size} remotes`, `Use remote="<regex>" to list individual calls with arguments.`, "", "count  dir method        remote", ...lines].join(
        "\n",
      ),
    ),
  );
}

/** Individual calls matching `include`, newest last. */
function calls(status: string, entries: Entry[], include: RegExp, limit: number) {
  const matched = entries.filter((entry) => include.test(`${entry.remote}:${entry.method}`));
  if (matched.length === 0) return text(`${status}\nNo calls match /${include.source}/.`);

  const shown = matched.slice(-limit);
  const lines = shown.map((entry) => formatCall(entry, true));
  const header = [`${status} · ${matched.length} matching /${include.source}/${shown.length < matched.length ? `, showing newest ${shown.length}` : ""}`];
  if (shown.length < matched.length || lines.some((line, i) => line !== formatCall(shown[i] as Entry, false))) {
    header.push(`Full untruncated calls: ${save("network", matched.map((entry) => formatCall(entry, false)).join("\n"))}`);
  }
  return text(fit("network", [...header, "", ...lines].join("\n")));
}

/** Compact mode truncates args and return values separately, so remote and caller always stay visible. */
function formatCall(entry: Entry, compact: boolean): string {
  const shorten = (value: string) => (compact ? truncate(value, 200) : value);
  const returned = entry.returned === undefined ? "" : ` → ${shorten(entry.returned || "nil")}`;
  const caller = entry.caller ? `  [by ${entry.caller}]` : "";
  return `+${entry.time.toFixed(2)}s ${entry.direction.padEnd(3)} ${entry.remote}:${entry.method}(${shorten(entry.args)})${returned}${caller}`;
}
