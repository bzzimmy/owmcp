import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runData } from "./bridge.js";
import { ensureDecompiler } from "./decompiler.js";
import { OUTPUT_DIR } from "./output.js";

const LUA = readFileSync(new URL("../lua/scripts.luau", import.meta.url), "utf8");
const DECOMPILE_FAILED = /^-- (failed to decompile|decompile failed)/;

export interface GameScript {
  /** Full instance path; duplicates get a " [2]" suffix. */
  path: string;
  class: string;
  hash: string;
  /** Where the decompiled source is saved (once decompiled). */
  file: string;
  /** Why decompiling failed, if it did. */
  error?: string;
}

interface RawScripts {
  placeId: number;
  scripts: { path: string; class: string; hash: string; source?: string }[];
}

const sources = new Map<string, string>(); // bytecode hash -> decompiled source
const written = new Map<string, string>(); // file -> hash currently on disk

/**
 * Lists the client's scripts. `decompile` is "all", "none", or a single script path.
 * Decompiled sources are cached by bytecode hash and mirrored to <root>/<path>.luau.
 */
export async function getScripts(decompile: string, port?: number): Promise<{ root: string; scripts: GameScript[] }> {
  if (decompile !== "none") await ensureDecompiler();

  const known = Object.fromEntries([...sources.keys()].map((hash) => [hash, true]));
  const raw = await runData<RawScripts>(LUA, { decompile: stripDuplicateSuffix(decompile), known }, { port, timeoutMs: 180_000 });
  const root = join(OUTPUT_DIR, "scripts", String(raw.placeId));

  const seen = new Map<string, number>();
  const scripts = raw.scripts.map((entry): GameScript => {
    const count = (seen.get(entry.path) ?? 0) + 1;
    seen.set(entry.path, count);
    const path = count > 1 ? `${entry.path} [${count}]` : entry.path;
    const script: GameScript = { path, class: entry.class, hash: entry.hash, file: join(root, ...fileSegments(path)) + ".luau" };

    if (entry.source !== undefined) {
      if (DECOMPILE_FAILED.test(entry.source)) script.error = entry.source.split("\n")[0];
      else sources.set(entry.hash, entry.source);
    }
    return script;
  });

  for (const script of scripts) {
    const source = sources.get(script.hash);
    if (source === undefined || written.get(script.file) === script.hash) continue;
    mkdirSync(dirname(script.file), { recursive: true });
    writeFileSync(script.file, source);
    written.set(script.file, script.hash);
  }

  return { root, scripts };
}

export function sourceOf(script: GameScript): string | undefined {
  return sources.get(script.hash);
}

function stripDuplicateSuffix(path: string): string {
  return path.replace(/ \[\d+\]$/, "");
}

/** Instance path -> safe file path segments. */
function fileSegments(path: string): string[] {
  return path.split(".").map((segment) => {
    const safe = segment.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_"); // eslint-disable-line no-control-regex
    return safe === "" || /^\.+$/.test(safe) ? "_" : safe;
  });
}
