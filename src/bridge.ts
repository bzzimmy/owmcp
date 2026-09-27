import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { send } from "./opiumware.js";
import { compactLines } from "./output.js";
import { sessionFor } from "./session.js";

/** What lua/runtime.luau reports back. */
export interface RunResult {
  ok: boolean;
  returns: string[];
  output: string[];
  error?: string;
  /** Set when the client was kicked or lost connection ("<ConnectionError>: <message>"). */
  disconnected?: string;
  /** Raw first return value (only with the `raw` option). */
  data?: unknown;
}

export interface RunOptions {
  port?: number;
  timeoutMs?: number;
  /** Return the first value as raw JSON in `data` instead of display strings. */
  raw?: boolean;
  /** Cancel the run's thread in-game if it times out (default true). */
  cancelOnTimeout?: boolean;
}

interface Pending {
  resolve: (result: RunResult) => void;
  /** The timeout and the home screen check; cleared once the run settles. */
  timers: NodeJS.Timeout[];
}

/** How long a run may take before checking whether Roblox is even in a game. */
const HOME_CHECK_MS = 2000;
const HOME_SCREEN = "Roblox is on the home screen, not in a game, so nothing runs. Use rejoin to go back into the game.";

const RUNTIME = readFileSync(new URL("../lua/runtime.luau", import.meta.url), "utf8");
const pending = new Map<string, Pending>();
let callbackPort: Promise<number> | undefined;

/** Local HTTP server that in-game scripts POST their results to (/<id>). */
function startCallbackServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const id = (req.url ?? "").slice(1);
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        res.end("ok");
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        entry.timers.forEach(clearTimeout);
        try {
          entry.resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as RunResult);
        } catch {
          entry.resolve({ ok: false, returns: [], output: [], error: "Malformed result received from Roblox." });
        }
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Encodes a JS string as a Luau string literal. */
export function luaString(value: string): string {
  // eslint-disable-next-line no-control-regex -- escaping control characters is the point
  return '"' + value.replace(/[\\"\x00-\x1f\x7f]/g, (c) => "\\" + c.charCodeAt(0).toString().padStart(3, "0")) + '"';
}

/** Runs Luau code in Roblox and waits for its result. */
export async function run(code: string, options: RunOptions = {}): Promise<RunResult> {
  const { port, timeoutMs = 15_000, raw = false, cancelOnTimeout = true } = options;
  callbackPort ??= startCallbackServer();

  const id = randomUUID();
  const callback = `http://127.0.0.1:${await callbackPort}/${id}`;
  const source = `local MCP_ID, MCP_CALLBACK, MCP_SOURCE, MCP_RAW = ${luaString(id)}, ${luaString(callback)}, ${luaString(code)}, ${String(raw)}\n${RUNTIME}`;

  let target = port;
  const result = new Promise<RunResult>((resolve, reject) => {
    const settle = () => {
      const entry = pending.get(id);
      pending.delete(id);
      entry?.timers.forEach(clearTimeout);
      return entry !== undefined;
    };
    const timer = setTimeout(() => {
      if (!settle()) return;
      void explainTimeout(id, target, cancelOnTimeout).then((message) => {
        reject(new Error(`No result within ${timeoutMs / 1000}s. ${message}`.trim()));
      });
    }, timeoutMs);
    const timers = [timer];
    // Nothing runs on the home screen, so fail fast instead of waiting out the whole timeout.
    if (timeoutMs > HOME_CHECK_MS) {
      timers.push(
        setTimeout(() => {
          if (target === undefined) return;
          void sessionFor(target)
            .catch(() => undefined)
            .then((session) => {
              if (session?.state === "home" && settle()) reject(new Error(HOME_SCREEN));
            });
        }, HOME_CHECK_MS),
      );
    }
    pending.set(id, { resolve, timers });
  });

  try {
    target = await send(source, port);
  } catch (error) {
    pending.get(id)?.timers.forEach(clearTimeout);
    pending.delete(id);
    throw error;
  }
  return result;
}

/** Runs tool Lua with JSON args (available as `ARGS`) and returns its raw first return value. */
export async function runData<T>(code: string, args: unknown, options: Omit<RunOptions, "raw"> = {}): Promise<T> {
  return (await runDataResult(code, args, options)).data as T;
}

/** Like runData, but also says whether the client was disconnected (see RunResult.disconnected). */
export async function runDataResult(
  code: string,
  args: unknown,
  options: Omit<RunOptions, "raw"> = {},
): Promise<{ data: unknown; disconnected?: string }> {
  const prelude = `local ARGS = game:GetService("HttpService"):JSONDecode(${luaString(JSON.stringify(args))})\n`;
  const result = await run(prelude + code, { ...options, raw: true });
  if (!result.ok) throw new Error(result.error ?? "Unknown error in Roblox");
  return { data: result.data, disconnected: result.disconnected };
}

/** Warning line for results from a disconnected client. */
export function disconnectWarning(reason: string): string {
  return `Warning: disconnected from the game (${reason}). Code still runs, but the server is gone. Use rejoin to continue.`;
}

const CANCEL = `
local runs = getgenv().__owmcp_runs
local entry = runs and runs[ARGS.id]
if not entry then return false end
runs[ARGS.id] = nil
getgenv().__owmcp_sinks[entry.sink] = nil
task.cancel(entry.thread)
return entry.sink.lines
`;

/** Why a run timed out: nothing runs on the home screen; otherwise cancel the run if requested. */
async function explainTimeout(id: string, port: number | undefined, cancelRun: boolean): Promise<string> {
  const session = port === undefined ? undefined : await sessionFor(port).catch(() => undefined);
  if (session?.state === "home") return HOME_SCREEN;
  return cancelRun ? cancel(id, port) : "";
}

/** Cancels a run that is still in progress (e.g. after a timeout). Returns a human-readable outcome. */
async function cancel(id: string, port?: number): Promise<string> {
  try {
    const output = await runData<string[] | false>(CANCEL, { id }, { port, timeoutMs: 3000, cancelOnTimeout: false });
    if (output === false) return "The run had already finished or crashed before reporting; check the logs.";
    const printed = output.length > 0 ? `\nOutput before the timeout:\n${compactLines(output).lines.join("\n")}` : "";
    return `The run was cancelled (threads it spawned with task.spawn/delay keep running).${printed}`;
  } catch {
    return "Could not cancel it: the client is not responding (possibly frozen by a loop that never yields).";
  }
}
