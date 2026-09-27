import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { send } from "./opiumware.js";
import { compactLines } from "./output.js";

/** What lua/runtime.luau reports back. */
export interface RunResult {
  ok: boolean;
  returns: string[];
  output: string[];
  error?: string;
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
  timer: NodeJS.Timeout;
}

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
        clearTimeout(entry.timer);
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

  const result = new Promise<RunResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      const outcome = cancelOnTimeout ? cancel(id, port) : Promise.resolve("");
      void outcome.then((message) => {
        reject(new Error(`No result within ${timeoutMs / 1000}s. ${message}`.trim()));
      });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
  });

  try {
    await send(source, port);
  } catch (error) {
    clearTimeout(pending.get(id)?.timer);
    pending.delete(id);
    throw error;
  }
  return result;
}

/** Runs tool Lua with JSON args (available as `ARGS`) and returns its raw first return value. */
export async function runData<T>(code: string, args: unknown, options: Omit<RunOptions, "raw"> = {}): Promise<T> {
  const prelude = `local ARGS = game:GetService("HttpService"):JSONDecode(${luaString(JSON.stringify(args))})\n`;
  const result = await run(prelude + code, { ...options, raw: true });
  if (!result.ok) throw new Error(result.error ?? "Unknown error in Roblox");
  return result.data as T;
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
