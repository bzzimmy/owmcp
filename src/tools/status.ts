import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runData } from "../bridge.js";
import { DECOMPILER_PORT, isDecompilerRunning } from "../decompiler.js";
import { findPorts } from "../opiumware.js";
import { text } from "../output.js";

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
        "Check the connection: which Roblox instances (Opiumware ports) are live, what game/player each is in, and whether the decompiler is running. Call this first or when something isn't working.",
    },
    async () => {
      const [ports, decompiler] = await Promise.all([findPorts(), isDecompilerRunning()]);
      if (ports.length === 0) {
        return text("No Opiumware instance found on ports 8390-8399. Roblox needs to be open with Opiumware attached.", true);
      }

      const instances = await Promise.all(
        ports.map(async (port) => {
          try {
            const info = await runData<string[]>(GAME_INFO, {}, { port, timeoutMs: 5000 });
            return `Port ${port}:\n  ${info.join("\n  ")}`;
          } catch (error) {
            return `Port ${port}: not responding (${error instanceof Error ? error.message : String(error)})`;
          }
        }),
      );

      const decompilerLine = decompiler
        ? `Decompiler: running on 127.0.0.1:${DECOMPILER_PORT}`
        : "Decompiler: not running (started automatically when needed)";
      return text([...instances, decompilerLine].join("\n\n"));
    },
  );
}
