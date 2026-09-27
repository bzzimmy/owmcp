import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runData } from "../bridge.js";
import { DECOMPILER_PORT, isDecompilerRunning } from "../decompiler.js";
import { findPorts } from "../opiumware.js";
import { text } from "../output.js";
import { sessionFor } from "../session.js";

const GAME_INFO = `
local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")
local player = Players.LocalPlayer
local ok, info = pcall(MarketplaceService.GetProductInfo, MarketplaceService, game.PlaceId)
return {
  "Game: " .. (ok and info.Name or "?") .. " (PlaceId " .. game.PlaceId .. ", JobId " .. game.JobId .. ")",
  "Player: " .. (player and player.Name or "?") .. " (character " .. (player and player.Character and "loaded" or "not loaded") .. ")",
  "Players in server: " .. #Players:GetPlayers(),
  "Executor: " .. (identifyexecutor and identifyexecutor() or "?"),
}
`;

export function registerStatus(server: McpServer) {
  server.registerTool(
    "status",
    {
      title: "Status",
      description:
        "Check the connection: which Roblox instances (Opiumware ports) are live, what game/player each is in, whether they were kicked or are on the home screen, and whether the decompiler is running. Call this first or when something isn't working.",
    },
    async () => {
      const [ports, decompiler] = await Promise.all([findPorts(), isDecompilerRunning()]);
      if (ports.length === 0) {
        return text("No Opiumware instance found on ports 8390-8399. Roblox needs to be open with Opiumware attached.", true);
      }

      const instances = await Promise.all(ports.map(describePort));
      const decompilerLine = decompiler
        ? `Decompiler: running on 127.0.0.1:${DECOMPILER_PORT}`
        : "Decompiler: not running (started automatically when needed)";
      return text([...instances, decompilerLine].join("\n\n"));
    },
  );
}

/** Status lines for one Roblox instance. */
export async function describePort(port: number): Promise<string> {
  const session = await sessionFor(port);
  if (session?.state === "home") {
    const next = session.placeId ? `Use rejoin to go back to place ${session.placeId}.` : "Join a game in Roblox first.";
    return `Port ${port}: on the Roblox home screen, not in a game. ${next}`;
  }

  const lines: string[] = [];
  if (session?.state === "disconnected") {
    const at = session.since?.toTimeString().slice(0, 8) ?? "?";
    lines.push(`DISCONNECTED at ${at}: ${session.reason ?? "unknown reason"}. The game is dead; use rejoin to continue.`);
  }
  try {
    lines.push(...(await runData<string[]>(GAME_INFO, {}, { port, timeoutMs: 5000 })));
  } catch (error) {
    lines.push(`Not responding (${error instanceof Error ? error.message : String(error)})`);
  }
  return `Port ${port}:\n  ${lines.join("\n  ")}`;
}
