# owmcp

An MCP server that lets AI agents drive the Opiumware Roblox executor on macOS. Agents can write a script, run it, check the console or a screenshot, and iterate on their own. It's vibeslopped (mostly written with AI tools), so expect some rough edges, and feel free to [open an issue](https://github.com/bzzimmy/owmcp/issues).

## Tools

| Tool | What it does |
|---|---|
| `status` | Shows live Roblox instances, their game and player, whether they were kicked, and the decompiler state. |
| `execute` | Runs Luau code or a file and returns values, prints, and errors with tracebacks. Runs that time out are cancelled. |
| `logs` | Reads the Roblox console, filtered by level, regex, time, or since the last `execute`. |
| `scripts` | Lists, searches, and reads decompiled client scripts, mirrored to `.luau` files you can grep. |
| `network` | Captures remote traffic with arguments, return values, and calling scripts. Hooks exist only while capturing. |
| `screenshot` | Captures the Roblox window, even when covered, to check ESP, UI, and menus. |
| `rejoin` | Returns to the last game after a kick or from the home screen, in the same server or any other. |

When the client is kicked, results carry a warning so the agent knows to `rejoin`. Large outputs are saved to `$TMPDIR/owmcp/`, and tools return a path and a preview instead.

## Setup

You need macOS, Node.js 18+, and [Opiumware](https://opiumware.com) attached to Roblox. `screenshot` also needs Screen Recording permission for your MCP client.

```sh
git clone https://github.com/bzzimmy/owmcp && cd owmcp
npm install
```

Add the server to your MCP client, such as Claude Desktop or `~/.config/mcp/mcp.json`:

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

Keep the server running between calls so the decompile cache survives, and allow tool calls up to about 5 minutes. Then join a game and call `status` to check the connection.

## How it works

Scripts go to Opiumware's local TCP server on ports 8390–8399, wrapped in `lua/runtime.luau`, which captures their output and posts it back over a local HTTP callback. Logs and kick detection come straight from `~/Library/Logs/Roblox`, and decompiling uses Opiumware's bundled decompiler, started on demand.

## Development

```sh
npm run build   # compile TypeScript
npm run lint    # ESLint, tsc, and luau-lsp
```

Rebuild after pulling, since clients run `build/index.js`.

## Disclaimer

Executors violate the Roblox Terms of Use and can get your account banned. `execute` runs arbitrary code in your client, so only connect agents you trust.

## License

[MIT](LICENSE) © 2026 [Ben Zimmermann](https://github.com/bzzimmy)
