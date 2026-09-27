import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tempPath, text } from "../output.js";
import { portOwner } from "../session.js";

const exec = promisify(execFile);
const MAX_SIZE = 1024;

// Lists on-screen Roblox windows as "windowId pid" lines (JXA, no extra dependencies).
const LIST_WINDOWS = `
ObjC.import("CoreGraphics");
const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)));
windows
  .filter((w) => w.kCGWindowLayer === 0 && /^Roblox/.test(w.kCGWindowOwnerName))
  .map((w) => w.kCGWindowNumber + " " + w.kCGWindowOwnerPID)
  .join("\\n");
`;

export function registerScreenshot(server: McpServer) {
  server.registerTool(
    "screenshot",
    {
      title: "Screenshot",
      description:
        "Capture the Roblox window as the player sees it (works even if other windows cover it). Use to verify visual scripts (ESP, UI, menus). Each image costs ~1K tokens, so use sparingly.",
      inputSchema: {
        port: z.number().int().optional().describe("Opiumware port of the Roblox instance (default: first Roblox window)."),
      },
    },
    async ({ port }) => {
      const windows = (await exec("osascript", ["-l", "JavaScript", "-e", LIST_WINDOWS])).stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(" "));
      if (windows.length === 0) return text("No visible Roblox window found (is Roblox open and not minimized?).", true);

      let windowId = windows[0]?.[0];
      if (port !== undefined) {
        const pid = await portOwner(port);
        windowId = windows.find(([, owner]) => owner === pid)?.[0];
        if (!windowId) return text(`No Roblox window found for port ${port}.`, true);
      }

      const full = tempPath("screenshot", "png");
      const small = tempPath("screenshot-small", "jpg");
      try {
        await exec("screencapture", ["-x", "-o", "-l", windowId ?? "", full]);
        await exec("sips", ["-Z", String(MAX_SIZE), "-s", "format", "jpeg", "-s", "formatOptions", "70", full, "--out", small]);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return text(`Screenshot failed (the host app may need Screen Recording permission in System Settings): ${reason}`, true);
      }

      return {
        content: [
          { type: "image" as const, data: (await readFile(small)).toString("base64"), mimeType: "image/jpeg" },
          { type: "text" as const, text: `Full resolution: ${full}` },
        ],
      };
    },
  );
}
