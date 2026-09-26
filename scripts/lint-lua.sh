#!/bin/sh
# Type-checks lua/ with luau-lsp (defaults to the binary bundled with Opiumware).
set -e
cd "$(dirname "$0")/.."

LUAU_LSP="${LUAU_LSP:-$HOME/Opiumware/modules/LuauLSP/LuauLSP}"
ROBLOX_DEFS=.cache/roblox.d.luau

if [ ! -f "$ROBLOX_DEFS" ]; then
  mkdir -p .cache
  curl -fsSL -o "$ROBLOX_DEFS" https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/main/scripts/globalTypes.d.luau
fi

"$LUAU_LSP" analyze --platform=roblox --defs="$ROBLOX_DEFS" --defs=lua/types/executor.d.luau lua/*.luau
