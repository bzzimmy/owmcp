import { isListening } from "./opiumware.js";

/** Opiumware's bundled decompiler server, which the in-game decompile() calls. */
export const DECOMPILER_PORT = 9002;

export function isDecompilerRunning(): Promise<boolean> {
  return isListening(DECOMPILER_PORT);
}
