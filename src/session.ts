import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { latestLogFile } from "./robloxLog.js";

const exec = promisify(execFile);

/** Where a Roblox instance is, according to its log. */
export interface Session {
  /** "disconnected": kicked or lost connection (the error prompt is showing). "home": on the Roblox home screen. */
  state: "in-game" | "disconnected" | "home";
  /** When the current state began. */
  since?: Date;
  /** The disconnect reason (the server's kick message when it gave one). */
  reason?: string;
  /** The last game joined, kept after leaving it. */
  placeId?: string;
  jobId?: string;
}

const JOIN = /! Joining game '([^']+)' place (\d+)/;
const KICK_MESSAGE = /Server Kick Message: (.*?)(?:; Metadata:.*)?$/;
const LOST_CONNECTION = /Lost connection with reason : (.*)$/;
const LEFT_GAME = "returnToLuaApp: (stage:UGCGame)";

/** PID of the process listening on a local TCP port. */
export async function portOwner(port: number): Promise<string | undefined> {
  try {
    return (await exec("lsof", ["-t", `-iTCP:${String(port)}`, "-sTCP:LISTEN"])).stdout.trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

/** The log file of the Roblox instance on a port. Its crash handler's arguments name the PID and log path. */
async function logFileFor(port: number): Promise<string | undefined> {
  const pid = await portOwner(port);
  if (pid) {
    const { stdout } = await exec("ps", ["-axww", "-o", "args="]).catch(() => ({ stdout: "" }));
    const handler = stdout.split("\n").find((line) => line.includes(`--annotation=PID=${pid} `));
    const path = handler && /--sentryLogPath (\S+)/.exec(handler)?.[1];
    if (path) return path;
  }
  return latestLogFile();
}

/** Current session state of the Roblox instance on a port, or undefined if its log can't be found. */
export async function sessionFor(port: number): Promise<Session | undefined> {
  const file = await logFileFor(port);
  if (!file) return undefined;

  const session: Session = { state: "home" };
  let kickMessage: string | undefined;
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    const time = () => new Date(line.slice(0, line.indexOf(",")));
    const join = JOIN.exec(line);
    if (join) {
      Object.assign(session, { state: "in-game", since: time(), reason: undefined, jobId: join[1], placeId: join[2] });
      kickMessage = undefined;
      continue;
    }
    kickMessage = KICK_MESSAGE.exec(line)?.[1] ?? kickMessage;
    const lost = LOST_CONNECTION.exec(line);
    if (lost && session.state === "in-game") {
      Object.assign(session, { state: "disconnected", since: time(), reason: kickMessage ?? lost[1] });
    } else if (line.includes(LEFT_GAME)) {
      Object.assign(session, { state: "home", since: time(), reason: undefined });
    }
  }
  return session;
}
