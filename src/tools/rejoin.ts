import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runData } from "../bridge.js";
import { findPorts } from "../opiumware.js";
import { text } from "../output.js";
import { sessionFor } from "../session.js";
import { describePort } from "./status.js";

const exec = promisify(execFile);
const TIMEOUT_MS = 60_000;
/** Scripts can run before the game has loaded; wait for it so status is complete. */
const READY = `return game:IsLoaded() and game:GetService("Players").LocalPlayer ~= nil`;

const DESCRIPTION = `Rejoin the last game after being kicked or disconnected, or from the Roblox home screen (see status). Waits until scripts run again and returns the new status.
- Everything set up in-game is gone afterwards (getgenv state, hooks, network capture, spawned loops).
- If anti-cheat kicked you, change what triggered it first, or you will be kicked again.`;

export function registerRejoin(server: McpServer) {
  server.registerTool(
    "rejoin",
    {
      title: "Rejoin game",
      description: DESCRIPTION,
      inputSchema: {
        server: z
          .enum(["same", "any"])
          .default("same")
          .describe('"same" rejoins the same server if it still exists; "any" lets Roblox pick one (may still be the same).'),
        port: z.number().int().optional().describe("Opiumware port of the Roblox instance (default: first found)."),
      },
    },
    async ({ server, port }) => {
      const target = port ?? (await findPorts())[0];
      if (target === undefined) return text("No Opiumware instance found on ports 8390-8399. Is Roblox open with Opiumware attached?", true);

      const session = await sessionFor(target);
      if (!session?.placeId) return text("No game was joined in this Roblox session, so there is nothing to rejoin. Join a game in Roblox first.", true);

      const startedAt = Date.now();
      const deadline = startedAt + TIMEOUT_MS;
      const instance = server === "same" && session.jobId ? `&gameInstanceId=${session.jobId}` : "";
      await exec("open", [`roblox://placeId=${session.placeId}${instance}`]);

      const joined = await until(deadline, async () => {
        const now = await sessionFor(target);
        return now?.state === "in-game" && (now.since?.getTime() ?? 0) >= startedAt;
      });
      const ready =
        joined &&
        (await until(deadline, () =>
          runData<boolean>(READY, {}, { port: target, timeoutMs: 3000, cancelOnTimeout: false }).then(
            (loaded) => loaded,
            () => false,
          ),
        ));
      if (!ready) {
        const step = joined ? "Joined, but scripts did not run" : "Roblox did not join the game";
        return text(`${step} within ${TIMEOUT_MS / 1000}s. Check status or screenshot (Roblox may be showing an error).`, true);
      }
      return text(`Rejoined.\n\n${await describePort(target)}`);
    },
  );
}

/** Polls check every second until it returns true or the deadline passes. */
async function until(deadline: number, check: () => Promise<boolean>): Promise<boolean> {
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(1000);
  }
  return false;
}
