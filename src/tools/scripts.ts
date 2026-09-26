import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getScripts, sourceOf, type GameScript } from "../gameScripts.js";
import { fit, save, text, truncate } from "../output.js";

const READ_LINES = 150;
const MATCHES_PER_SCRIPT = 5;
/** Above this many scripts, list shows counts per folder instead of every path. */
const LIST_INLINE = 60;
const MAX_FOLDERS = 40;

const DESCRIPTION = `Read the game's client-side code (LocalScripts, ModuleScripts; server Scripts never reach the client).
Decompiled sources are cached and saved as .luau files in a temp folder mirroring the game tree, so you can also grep/read them directly.
- list: script paths (optionally filtered).
- search: regex across all decompiled sources, returns path:line matches. The first search decompiles everything (a few seconds).
- read: one script's source with line numbers, ${READ_LINES} lines at a time (use startLine/endLine).`;

export function registerScripts(server: McpServer) {
  server.registerTool(
    "scripts",
    {
      title: "Game scripts",
      description: DESCRIPTION,
      inputSchema: {
        action: z.enum(["list", "search", "read"]),
        path: z.string().optional().describe("read: full script path as shown by list/search."),
        query: z.string().optional().describe("search: case-insensitive regex."),
        filter: z.string().optional().describe("list/search: case-insensitive regex on script paths, e.g. ReplicatedStorage."),
        startLine: z.number().int().min(1).optional().describe("read: first line (default 1)."),
        endLine: z.number().int().min(1).optional().describe(`read: last line (default startLine + ${READ_LINES - 1}).`),
        limit: z.number().int().min(1).max(500).default(30).describe("search: max matches shown."),
        port: z.number().int().optional().describe("Opiumware port (default: first found)."),
      },
    },
    async ({ action, path, query, filter, startLine, endLine, limit, port }) => {
      const filterPattern = regex(filter);
      if (filterPattern instanceof Error) return text(`Invalid filter regex: ${filterPattern.message}`, true);

      switch (action) {
        case "list":
          return list(filterPattern, port);
        case "read":
          if (!path) return text("read needs `path`.", true);
          return read(path, startLine, endLine, port);
        case "search": {
          const queryPattern = regex(query);
          if (!queryPattern) return text("search needs `query`.", true);
          if (queryPattern instanceof Error) return text(`Invalid query regex: ${queryPattern.message}`, true);
          return search(queryPattern, filterPattern, limit, port);
        }
      }
    },
  );
}

async function list(filter: RegExp | undefined, port?: number) {
  const { scripts } = await getScripts("none", port);
  const shown = scripts.filter((script) => !filter || filter.test(script.path)).sort((a, b) => a.path.localeCompare(b.path));

  const classes = new Map<string, number>();
  for (const script of shown) classes.set(script.class, (classes.get(script.class) ?? 0) + 1);
  const breakdown = [...classes].map(([name, count]) => `${count} ${name}`).join(", ");

  const header = filter ? `${shown.length} of ${scripts.length} scripts match /${filter.source}/` : `${scripts.length} scripts`;
  const lines = shown.map((script) => `${script.class.padEnd(12)} ${script.path}`);
  if (lines.length <= LIST_INLINE) return text([`${header} (${breakdown || "none"})`, "", ...lines].join("\n"));

  // Too many to show: summarize by folder and save the full list.
  const summary = folderCounts(shown.map((script) => script.path)).map(([folder, count]) => `${String(count).padStart(4)}  ${folder}`);
  return text(
    fit(
      "scripts-list",
      [
        `${header} (${breakdown}). Full list: ${save("scripts-list", lines.join("\n"))}`,
        "Scripts per folder (use filter to list a folder, e.g. filter=\"^ReplicatedStorage\"):",
        "",
        ...summary,
      ].join("\n"),
    ),
  );
}

async function read(path: string, startLine = 1, endLine?: number, port?: number) {
  const { scripts } = await getScripts(path, port);
  const script = scripts.find((candidate) => candidate.path === path);
  if (!script) return text(notFound(path, scripts), true);

  const source = sourceOf(script);
  if (source === undefined) return text(`Could not decompile ${path}: ${script.error ?? "unknown error"}`, true);

  const lines = source.split("\n");
  const from = Math.min(startLine, lines.length);
  const to = Math.min(endLine ?? from + READ_LINES - 1, lines.length);
  const width = String(to).length;
  const body = lines.slice(from - 1, to).map((line, i) => `${String(from + i).padStart(width)} | ${truncate(line)}`);

  const header = [`${script.class} ${script.path} · ${lines.length} lines · full source: ${script.file}`];
  if (from > 1 || to < lines.length) header.push(`Showing lines ${from}-${to} of ${lines.length}. Use startLine/endLine or grep the file for more.`);
  return text(fit("scripts-read", [...header, "", ...body].join("\n")));
}

async function search(query: RegExp, filter: RegExp | undefined, limit: number, port?: number) {
  const { root, scripts } = await getScripts("all", port);
  const searched = scripts.filter((script) => !filter || filter.test(script.path));

  const matches: { script: GameScript; line: number; text: string }[] = [];
  for (const script of searched) {
    sourceOf(script)
      ?.split("\n")
      .forEach((line, i) => {
        if (query.test(line)) matches.push({ script, line: i + 1, text: line.trim() });
      });
  }

  const failed = searched.filter((script) => script.error).length;
  const footer = `Sources: ${root}${failed > 0 ? ` (${failed} scripts failed to decompile)` : ""}`;
  if (matches.length === 0) return text(`No matches for /${query.source}/ in ${searched.length} scripts.\n${footer}`);

  // Inline: at most MATCHES_PER_SCRIPT per script and `limit` total, so one noisy script can't hide the rest.
  const perScript = new Map<GameScript, number>();
  const shown = matches.filter((match) => {
    const count = (perScript.get(match.script) ?? 0) + 1;
    perScript.set(match.script, count);
    return count <= MATCHES_PER_SCRIPT;
  }).slice(0, limit);

  const header = [`${matches.length} matches in ${perScript.size} of ${searched.length} scripts. ${footer}`];
  if (shown.length < matches.length) {
    const full = save("scripts-search", matches.map((m) => `${m.script.path}:${m.line}: ${m.text}`).join("\n"));
    header.push(`Showing ${shown.length} (max ${MATCHES_PER_SCRIPT} per script). All matches: ${full}`);
  }
  const lines = shown.map((m) => `${m.script.path}:${m.line}: ${truncate(m.text, 200)}`);
  return text(fit("scripts-search", [...header, "", ...lines].join("\n")));
}

/** Script counts per folder, grouped as deep as possible while staying within MAX_FOLDERS lines. */
function folderCounts(paths: string[]): [string, number][] {
  for (let depth = 8; ; depth--) {
    const counts = new Map<string, number>();
    for (const path of paths) {
      const folder = path.split(".").slice(0, -1).slice(0, depth).join(".") || "(root)";
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    if (counts.size <= MAX_FOLDERS || depth === 1) return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }
}

function notFound(path: string, scripts: GameScript[]): string {
  const name = (path.split(".").at(-1) ?? path).toLowerCase();
  const similar = scripts.filter((script) => script.path.toLowerCase().includes(name)).slice(0, 10);
  return [`No script at path "${path}".`, ...(similar.length > 0 ? ["Similar:", ...similar.map((s) => `  ${s.path}`)] : ["Use action=list to see paths."])].join("\n");
}

function regex(source: string | undefined): RegExp | Error | undefined {
  if (source === undefined) return undefined;
  try {
    return new RegExp(source, "i");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
