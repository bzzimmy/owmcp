# owmcp

owmcp is an MCP server that lets AI agents drive the Opiumware Roblox executor on macOS. It enables an agent to write a script, run it, check the logs or a screenshot, and iterate autonomously.

## Tools

| Tool | Description |
|---|---|
| `status` | Check live Roblox instances (game, player, port), whether they were kicked or are on the home screen, and decompiler state. |
| `execute` | Run Luau code or a file. Returns return values, prints, and errors with tracebacks. Cancels the run on timeout. |
| `logs` | Read the Roblox console. Filter by level, regex, time, limit, or "since the last execute". |
| `scripts` | List, search, and read decompiled client scripts, mirrored as `.luau` files you can grep. |
| `network` | Start, stop, and read captures of remote traffic (FireServer, InvokeServer, OnClientEvent), including arguments, return values, and calling scripts. Hooks only exist during capture. |
| `screenshot` | Capture the Roblox window (even if covered) to visually verify ESP, UI, and menus. |
| `rejoin` | Rejoin the last game (same server or any) after a kick or from the home screen, and wait until scripts run again. |

If the client gets kicked or disconnected, `execute` results carry a warning and `status` shows the reason, so the agent knows to `rejoin`.

Large outputs are saved to temporary files (`$TMPDIR/owmcp/`). Tools return the file path and a preview to keep the agent's context small.

## Requirements

- macOS
- [Opiumware](https://opiumware.com) attached to Roblox
- Node.js 18+
- Screen Recording permissions for your MCP client's host app (only needed for `screenshot`).

## Setup

```sh
git clone https://github.com/bzzimmy/owmcp && cd owmcp
npm install
```

Configure your MCP client (e.g., Claude Desktop or `~/.config/mcp/mcp.json`):

```json
{
  "mcpServers": {
    "opiumware": {
      "command": "node",
      "args": ["/absolute/path/to/owmcp/build/index.js"]
    }
  }
}
```

- Keep the server process alive between calls. Network captures and the decompile cache live in-process.
- Allow tool calls to run for up to ~5 minutes (`execute` takes timeouts up to 300s).
- Open Roblox, attach Opiumware, join a game, and call `status` to verify the connection.

## How it works

Scripts are sent to Opiumware's local TCP server (ports 8390–8399). They are wrapped in `lua/runtime.luau`, which captures output and posts the results back to a local HTTP callback.

- You never need to paste code into the executor.
- Rejoining a game does not break the connection.
- Logs are read directly from `~/Library/Logs/Roblox`.
- Decompiling uses Opiumware's bundled decompiler, which starts automatically if needed.

## Development

```sh
npm run build   # Compile TypeScript
npm run lint    # Run ESLint, tsc, and luau-lsp
```

Rebuild after pulling updates. Clients run `build/index.js`.

## Disclaimer

Executors violate the Roblox Terms of Use and can lead to account bans. The `execute` tool runs arbitrary code in your client, so only connect agents you trust.

## License

MIT © Ben Zimmermann
