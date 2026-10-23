// Launcher protocol: node launcher-runtime.mjs stop [token], wait-ready <token>,
// or check-endpoint <host> <port>. Replacement requests ordinary app quit and
// waits for that exact instance to exit. No process discovery or signals.
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const IDENTITY = {
  label: JSON.parse(readFileSync(join(REPO_ROOT, "src-tauri/tauri.conf.json"), "utf8")).productName,
  executable: /^\[package\][^[]*?^name = "([^"]+)"/m.exec(readFileSync(join(REPO_ROOT, "src-tauri/Cargo.toml"), "utf8"))[1],
};
const root = process.env.QUICKDECK_DATA_DIR || join(homedir(), ".quickdeck");
const endpointFile = join(root, "instance.endpoint");
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

export async function readEndpoint(path = endpointFile) {
  try {
    const [port, metadata] = (await readFile(path, "utf8")).trim().split("\n");
    return { port: Number(port), ...(metadata ? JSON.parse(metadata) : {}) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function request(port, message, timeout = 1500) {
  return new Promise((resolveRequest, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let reply = "";
    socket.setTimeout(timeout, () => socket.destroy(new Error("The running app did not answer.")));
    socket.on("connect", () => socket.end(message));
    socket.on("data", (data) => {
      reply += data.toString();
      if (reply.length > 4096) socket.destroy(new Error("Invalid launcher response."));
    });
    socket.on("error", reject);
    socket.on("end", () => resolveRequest(reply));
  });
}

async function isAlive(endpoint) {
  try { return await request(endpoint.port, "status__") === endpoint.token; }
  catch (error) { if (error.code === "ECONNREFUSED") return false; throw error; }
}

export async function stopRuntime(expectedToken, path = endpointFile, checkout = REPO_ROOT, wait = 30000) {
  const endpoint = await readEndpoint(path);
  if (!endpoint) return;
  // A dead endpoint is harmless, but an old app without this protocol cannot
  // be safely replaced by a signal. Its normal Quit remains available.
  if (!endpoint.token) {
    try { await request(endpoint.port, "status__"); }
    catch (error) { if (error.code === "ECONNREFUSED") return; throw error; }
    throw new Error("Quit the running app normally before using this updated launcher.");
  }
  if (expectedToken && endpoint.token !== expectedToken) return;
  if (!await isAlive(endpoint)) return;
  if (endpoint.launcherRoot !== checkout) throw new Error("The running app belongs to another launch location. Quit it normally before replacing it.");
  const reply = await request(endpoint.port, `quit____${endpoint.token}\n`);
  if (reply !== "requested") throw new Error("The running instance changed; replacement was cancelled.");
  const deadline = Date.now() + wait;
  while (await isAlive(endpoint)) {
    if (Date.now() >= deadline) throw new Error("Replacement stopped: the app has not quit. Finish or cancel its save-and-quit dialog, then run the launcher again.");
    await delay(100);
  }
}

export async function waitReady(token, path = endpointFile, wait = 180000) {
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    const endpoint = await readEndpoint(path);
    if (endpoint?.token === token && await isAlive(endpoint)) return;
    await delay(100);
  }
  throw new Error("The selected app did not become ready. Another concurrent launcher may have won; no process was stopped.");
}

export async function assertEndpointAvailable(host, port) {
  await new Promise((resolveProbe, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Cannot bind ${host}:${port}. The existing listener was left running.`)));
    server.listen({ host, port, exclusive: true }, () => server.close((error) => error ? reject(error) : resolveProbe()));
  });
}

async function main([command, ...args]) {
  if (command === "stop") return stopRuntime(args[0]);
  if (command === "wait-ready" && args[0]) return waitReady(args[0]);
  if (command === "check-endpoint" && args[0] && Number.isInteger(Number(args[1]))) return assertEndpointAvailable(args[0], Number(args[1]));
  throw new Error("Expected stop [token], wait-ready <token>, or check-endpoint <host> <port>.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
