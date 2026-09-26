import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isListening } from "./opiumware.js";

/** Opiumware's bundled decompiler server, which the in-game decompile() calls. */
export const DECOMPILER_PORT = 9002;
const DECOMPILER_PATH = join(homedir(), "Opiumware", "modules", "decompiler", "Decompiler");

export function isDecompilerRunning(): Promise<boolean> {
  return isListening(DECOMPILER_PORT);
}

/** Starts the decompiler (detached, like Opiumware does) if it isn't running yet. */
export async function ensureDecompiler(): Promise<void> {
  if (await isDecompilerRunning()) return;
  if (!existsSync(DECOMPILER_PATH)) throw new Error(`Decompiler not found at ${DECOMPILER_PATH}.`);

  spawn(DECOMPILER_PATH, [], { detached: true, stdio: "ignore" }).unref();
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(100);
    if (await isDecompilerRunning()) return;
  }
  throw new Error(`Decompiler did not start listening on port ${DECOMPILER_PORT}.`);
}
