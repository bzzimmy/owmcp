import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runData } from "../bridge.js";
import { fit, save, text, truncate } from "../output.js";
import { parseRegex } from "../regex.js";

const LUA = readFileSync(new URL("../../lua/network.luau", import.meta.url), "utf8");
/** Per-value cap in the saved full log, so huge payloads stay greppable. */
const MAX_SAVED_VALUE = 2_000;

const DESCRIPTION = `Capture remote traffic between the client and server: outgoing FireServer/InvokeServer (with InvokeServer return values and the calling script) and incoming OnClientEvent.
- start: begin a fresh capture (replaces the previous log). stop: stop recording and remove the hooks (the log is kept). read: view the log (works while running).
- Hooks only exist while capturing, so stop as soon as you have what you need.
- read without \`remote\` gives a per-remote summary (count, rate, latest args); with \`remote\` it lists individual calls with arguments, collapsing consecutive identical calls.
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
  wasCapturing: boolean;
  previousCount: number;
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
        limit: z.number().int().min(1).max(500).default(20).describe("read: max rows shown (remotes in the summary, newest calls with remote=)."),
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
      if (action === "start") {
        const discarded = capture.previousCount > 0 ? ` (discarded the previous capture's ${capture.previousCount} calls)` : "";
        return text(`Capturing remote traffic${discarded}. Do the thing in-game (or via execute), then use action=read.`);
      }
      if (!capture.started) return text("No capture yet. Use action=start first.", true);
      if (action === "stop") {
        if (!capture.wasCapturing) return text(`Capture was not running (${capture.count} calls from the last capture are kept).`);
        return text(`Stopped. ${capture.count} calls recorded in ${capture.elapsed.toFixed(1)}s; use action=read to view them.`);
      }

      const entries = (capture.log ?? []).filter((entry) => !hide || !hide.test(entry.remote));
      const status = [
        `Capture ${capture.capturing ? "running" : "stopped"} · ${capture.elapsed.toFixed(1)}s · ${capture.count} calls`,
        capture.dropped > 0 ? `${capture.dropped} oldest dropped (buffer full)` : undefined,
        hide ? `${capture.count - entries.length} excluded` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");

      if (entries.length === 0) return text(`${status}\nNo calls recorded${hide ? " (after exclude)" : ""}.`);
      return include ? calls(status, entries, include, limit) : summary(status, entries, capture.elapsed, limit);
    },
  );
}

/** One line per remote: how often it fired and its latest arguments. */
function summary(status: string, entries: Entry[], elapsed: number, limit: number) {
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
    .slice(0, limit)
    .map(({ entry, count }) => {
      const rate = `${(count / Math.max(elapsed, 1)).toFixed(1)}/s`;
      return `${String(count).padStart(5)} ${rate.padStart(7)}  ${entry.direction.padEnd(3)} ${entry.method.padEnd(13)} ${entry.remote}  latest: (${truncate(entry.args, 120)})`;
    });
  if (sorted.length > limit) lines.push(`… ${sorted.length - limit} more remotes (raise limit or use exclude).`);

  return text(
    fit(
      "network",
      [`${status} · ${groups.size} remotes`, `Use remote="<regex>" to list individual calls with arguments.`, "", "count    rate  dir method        remote", ...lines].join(
        "\n",
      ),
    ),
  );
}

/** Individual calls matching `include`, newest last. Consecutive identical calls are collapsed to (xN). */
function calls(status: string, entries: Entry[], include: RegExp, limit: number) {
  const matched = entries.filter((entry) => include.test(`${entry.remote}:${entry.method}`));
  if (matched.length === 0) return text(`${status}\nNo calls match /${include.source}/.`);

  const groups: { entry: Entry; count: number }[] = [];
  for (const entry of matched) {
    const last = groups.at(-1);
    if (last && sameCall(last.entry, entry)) last.count++;
    else groups.push({ entry, count: 1 });
  }

  const shown = groups.slice(-limit);
  const collapsed = matched.length - groups.length;
  const lines = shown.map((group) => formatCall(group, 200));
  const header = [
    [
      `${status} · ${matched.length} matching /${include.source}/`,
      collapsed > 0 ? `${collapsed} repeats collapsed` : undefined,
      shown.length < groups.length ? `showing newest ${shown.length}` : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
  ];
  if (shown.length < groups.length || lines.some((line, i) => line !== formatCall(shown[i] as { entry: Entry; count: number }, Infinity))) {
    const full = groups.map((group) => formatCall(group, MAX_SAVED_VALUE)).join("\n");
    header.push(`Full calls (values capped at ${MAX_SAVED_VALUE} chars): ${save("network", full)}`);
  }
  return text(fit("network", [...header, "", ...lines].join("\n")));
}

function sameCall(a: Entry, b: Entry): boolean {
  return a.remote === b.remote && a.method === b.method && a.args === b.args && a.returned === b.returned && a.caller === b.caller;
}

/** Args and return values are truncated separately, so remote and caller always stay visible. */
function formatCall({ entry, count }: { entry: Entry; count: number }, maxValue: number): string {
  const shorten = (value: string) => truncate(value, maxValue);
  const returned = entry.returned === undefined ? "" : ` → ${shorten(entry.returned || "nil")}`;
  const caller = entry.caller ? `  [by ${entry.caller}]` : "";
  const repeat = count > 1 ? `  (x${count})` : "";
  return `+${entry.time.toFixed(2)}s ${entry.direction.padEnd(3)} ${entry.remote}:${entry.method}(${shorten(entry.args)})${returned}${caller}${repeat}`;
}
