import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { send } from "./opiumware.js";

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
  const { port, timeoutMs = 15_000, raw = false } = options;
  callbackPort ??= startCallbackServer();

  const id = randomUUID();
  const callback = `http://127.0.0.1:${await callbackPort}/${id}`;
  const source = `local MCP_CALLBACK, MCP_SOURCE, MCP_RAW = ${luaString(callback)}, ${luaString(code)}, ${String(raw)}\n${RUNTIME}`;

  const result = new Promise<RunResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          `No result within ${timeoutMs / 1000}s. The code may still be running (long yield/loop) or crashed before reporting; check the logs.`,
        ),
      );
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
