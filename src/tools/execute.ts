import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run, type RunResult } from "../bridge.js";
import { compactLines, fit, save, text } from "../output.js";
import { lastExecute } from "../robloxLog.js";

const DESCRIPTION = `Run Luau in the Roblox client (Opiumware, thread identity 8) and get back return values, print/warn output, and errors with traceback.
- Just \`return\` values; tables, Instances, Vector3s etc. are serialized automatically. Don't JSONEncode.
- Each run has its own global scope. Use getgenv() to keep state between runs. _G is the executor's; the game's is getrenv()._G.
- Full executor API is available (getgc, hookmetamethod, decompile, firesignal, ...).
- Long-running code (loops, listeners) should task.spawn and return right away. On timeout the run itself is cancelled, but threads it spawned keep running.
- Errors returned here are NOT in the console. Errors/prints after the run returns (spawned/deferred code) only show in logs: use logs sinceExecute=true.
- Separate execute calls made in parallel may run in any order.
- Large results are saved to a temp file whose path is returned.`;

export function registerExecute(server: McpServer) {
  server.registerTool(
    "execute",
    {
      title: "Execute Luau",
      description: DESCRIPTION,
      inputSchema: {
        code: z.string().optional().describe("Luau source to run. Provide either code or file."),
        file: z.string().optional().describe("Path to a local .lua/.luau file to run instead of code."),
        port: z.number().int().optional().describe("Opiumware port of the Roblox instance (default: first found, see status)."),
        timeout: z.number().min(1).max(300).default(15).describe("Seconds to wait for the result."),
      },
    },
    async ({ code, file, port, timeout }) => {
      if ((code === undefined) === (file === undefined)) {
        return text("Provide exactly one of `code` or `file`.", true);
      }
      const path = resolve(file ?? "");
      const source = code ?? (await readFile(path, "utf8").catch(() => undefined));
      if (source === undefined) return text(`Could not read file: ${path}`, true);

      lastExecute.at = Date.now();
      const result = await run(source, { port, timeoutMs: timeout * 1000 });
      return text(fit("execute", formatResult(result)), !result.ok);
    },
  );
}

function formatResult(result: RunResult): string {
  const sections: string[] = [];
  if (result.output.length > 0) {
    const { lines, truncated } = compactLines(result.output);
    const full = truncated ? `\n(long lines truncated; full output: ${save("execute-output", result.output.join("\n"))})` : "";
    sections.push("Output:\n" + lines.join("\n") + full);
  }
  if (!result.ok) {
    sections.push("Error:\n" + (result.error ?? "Unknown error").trimEnd());
  } else if (result.returns.length === 1) {
    sections.push("Returned:\n" + (result.returns[0] ?? ""));
  } else if (result.returns.length > 1) {
    sections.push("Returned:\n" + result.returns.map((value, i) => `[${i + 1}] ${value}`).join("\n"));
  }
  return sections.join("\n\n") || "Ran successfully (no output or return values).";
}
