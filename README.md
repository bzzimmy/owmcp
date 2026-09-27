# owmcp

An MCP server that lets AI agents execute scripts and read logs through the Opiumware executor for interactive Roblox script development.

## Tools

| Tool | What it does |
|---|---|
| `status` | Live Roblox instances (game, player, port) and decompiler state |
| `execute` | Run Luau (inline or from a file) and get return values, prints, and errors with tracebacks |
| `logs` | Read the Roblox console, filtered by level, regex, time, or "since the last execute" |
| `scripts` | List, search, and read the game's decompiled client scripts |
| `network` | Capture remote traffic with arguments, return values, and calling scripts |

Large outputs are saved to temp files (`$TMPDIR/owmcp/`) and the tool returns the path plus a preview, so results stay small in the agent's context.

## Requirements

- macOS with [Opiumware](https://opiumware.com) attached to Roblox
- Node.js 18+

## Setup

```sh
git clone https://github.com/bzzimmy/owmcp && cd owmcp
npm install   # also builds to build/
```

Add it to your MCP client config (e.g. `~/.config/mcp/mcp.json`, `.mcp.json`, or Claude Desktop):

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

Keep the server process alive between calls if your client supports it: network captures and the decompile cache live in the process. Allow tool calls of up to ~5 minutes, since `execute` accepts timeouts up to 300s.

Then open Roblox, attach Opiumware, and join a game. Call `status` to check the connection.

## How it works

Code is sent to Opiumware over its local TCP port (8390–8399), wrapped in a small runtime (`lua/runtime.luau`) that captures output and posts the result back to a local HTTP callback. Nothing needs to be pasted into the executor, and rejoining a game doesn't break anything. Logs are read from `~/Library/Logs/Roblox`, and decompiling uses Opiumware's bundled decompiler, which is started automatically if needed.

## Development

```sh
npm run build   # compile TypeScript
npm run lint    # ESLint, tsc, and luau-lsp for lua/
```

Rebuild after pulling changes; clients run `build/index.js`.

## Disclaimer

Using executors violates Roblox's Terms of Use and can get accounts banned. `execute` runs arbitrary code in your client, so only connect agents you trust.

## License

MIT © Ben Zimmermann
