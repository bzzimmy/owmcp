import net from "node:net";
import { deflateSync } from "node:zlib";

const HOST = "127.0.0.1";
const PORTS = Array.from({ length: 10 }, (_, i) => 8390 + i);

function connect(port: number, timeoutMs: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("error", () => {
      resolve(null);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

/** Ports with an injected Roblox instance listening (one per instance). */
export async function findPorts(): Promise<number[]> {
  const open = await Promise.all(
    PORTS.map(async (port) => {
      const socket = await connect(port, 300);
      socket?.destroy();
      return socket ? port : null;
    }),
  );
  return open.filter((port) => port !== null);
}

/** Sends Luau source to Opiumware. Returns the port it was sent to. */
export async function send(source: string, port?: number): Promise<number> {
  const target = port ?? (await findPorts())[0];
  if (target === undefined) {
    throw new Error("No Opiumware instance found on ports 8390-8399. Is Roblox open with Opiumware attached?");
  }

  const socket = await connect(target, 2000);
  if (!socket) throw new Error(`Could not connect to Opiumware on port ${target}.`);

  const payload = deflateSync(Buffer.from("OpiumwareScript " + source, "utf8"));
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.end(payload, resolve);
  });
  return target;
}
