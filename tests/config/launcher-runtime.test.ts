// @vitest-environment node
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The launcher helper is plain ESM because both shell families execute it directly.
// @ts-expect-error The directly executed .mjs helper intentionally has no declaration file.
import { REPO_ROOT } from "../../scripts/launcher-runtime.mjs";

type Launcher = {
  REPO_ROOT: string;
  stopRuntime: (token: string | undefined, path: string, checkout: string, wait?: number) => Promise<void>;
  waitReady: (token: string, path: string, wait?: number) => Promise<void>;
};

let root: string;
let endpointPath: string;
let launcher: Launcher;
const servers = new Set<Server>();
let processGuards: { mock: { calls: unknown[][] } }[];

async function closeServer(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function runtime(options: { checkout?: string; quitReply?: string } = {}) {
  const token = randomUUID();
  const commands: string[] = [];
  let acknowledgeQuit!: () => void;
  const quitReceived = new Promise<void>((resolve) => { acknowledgeQuit = resolve; });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let command = "";
    socket.on("data", (data) => { command += data.toString(); });
    socket.on("end", () => {
      commands.push(command);
      if (command === "status__") socket.end(token);
      else if (command === `quit____${token}\n`) {
        socket.end(options.quitReply ?? "requested");
        acknowledgeQuit();
      } else {
        socket.end("unexpected command");
      }
    });
  });
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
  await writeFile(endpointPath, `${address.port}\n${JSON.stringify({ token, launcherRoot: options.checkout ?? launcher.REPO_ROOT })}\n`);
  return { token, commands, server, quitReceived };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "quickdeck-launcher-fixture-"));
  endpointPath = join(root, "instance.endpoint");
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "src-tauri"));
  await Promise.all([
    "scripts/launcher-runtime.mjs",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
  ].map((path) => copyFile(join(REPO_ROOT, path), join(root, path))));
  const processOperations = ["exec", "execFile", "spawn", "fork", "execSync", "execFileSync", "spawnSync"] as const;
  processGuards = processOperations.map((operation) => vi.spyOn(childProcess, operation)
    .mockImplementation(() => { throw new Error(`Unexpected process operation: ${operation}`); }));
  processGuards.push(vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("Unexpected process signal"); }));
  // Install guards before loading so named native imports receive them too.
  syncBuiltinESMExports();
  // Native loading gives the disposable helper its own checkout identity.
  launcher = createRequire(import.meta.url)(join(root, "scripts/launcher-runtime.mjs"));
  expect(launcher.REPO_ROOT).toBe(await realpath(root));
  expect(launcher.REPO_ROOT).not.toBe(REPO_ROOT);
});

afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await Promise.all([...servers].map(closeServer));
  servers.clear();
  await rm(root, { recursive: true, force: true });
});

describe("launcher ordinary quit protocol", () => {
  it("leaves a replacement running when cleanup carries a stale token", async () => {
    const app = await runtime();
    await launcher.stopRuntime("stale-token", endpointPath, launcher.REPO_ROOT);
    expect(app.commands).toEqual([]);
    expect(app.server.listening).toBe(true);
  });

  it("refuses a live app from another checkout without asking it to quit", async () => {
    const app = await runtime({ checkout: join(root, "another-checkout") });
    await expect(launcher.stopRuntime(undefined, endpointPath, launcher.REPO_ROOT))
      .rejects.toThrow("another launch location");
    expect(app.commands).toEqual(["status__"]);
    expect(app.server.listening).toBe(true);
  });

  it("requests the matching app's ordinary quit and waits for it to exit", async () => {
    const app = await runtime();
    let stopped = false;
    const stopping = launcher.stopRuntime(app.token, endpointPath, launcher.REPO_ROOT)
      .then(() => { stopped = true; });
    await app.quitReceived;
    expect(stopped).toBe(false);
    expect(app.server.listening).toBe(true);
    expect(app.commands).toContain(`quit____${app.token}\n`);
    await closeServer(app.server);
    await stopping;
    expect(stopped).toBe(true);
    expect(app.commands.every((command) => command === "status__" || command === `quit____${app.token}\n`)).toBe(true);
  });

  it("does not touch a replacement published while an old quit settles", async () => {
    const old = await runtime();
    const stopping = launcher.stopRuntime(old.token, endpointPath, launcher.REPO_ROOT);
    await old.quitReceived;
    await closeServer(old.server);
    const replacement = await runtime();
    await stopping;
    await launcher.stopRuntime(old.token, endpointPath, launcher.REPO_ROOT);
    expect(replacement.commands).toEqual([]);
    expect(replacement.server.listening).toBe(true);
  });

  it("leaves a vetoed quit running and reports that replacement stopped", async () => {
    const app = await runtime();
    await expect(launcher.stopRuntime(app.token, endpointPath, launcher.REPO_ROOT, 0))
      .rejects.toThrow("Finish or cancel its save-and-quit dialog");
    expect(app.server.listening).toBe(true);
    expect(app.commands).toContain(`quit____${app.token}\n`);
    for (const guard of processGuards) expect(guard).not.toHaveBeenCalled();
  });

  it("cancels replacement when the app rejects the quit token", async () => {
    const app = await runtime({ quitReply: "rejected" });
    await expect(launcher.stopRuntime(app.token, endpointPath, launcher.REPO_ROOT))
      .rejects.toThrow("replacement was cancelled");
    expect(app.commands).toEqual(["status__", `quit____${app.token}\n`]);
    expect(app.server.listening).toBe(true);
  });

  it("accepts readiness only from the matching instance", async () => {
    const app = await runtime();
    await launcher.waitReady(app.token, endpointPath, 1000);
    expect(app.commands).toEqual(["status__"]);
    await expect(launcher.waitReady("another-token", endpointPath, 1))
      .rejects.toThrow("did not become ready");
    expect(app.commands).toEqual(["status__"]);
  });

  it("treats an endpoint whose app has exited as harmless", async () => {
    const app = await runtime();
    await closeServer(app.server);
    await launcher.stopRuntime(app.token, endpointPath, launcher.REPO_ROOT);
    expect(app.commands).toEqual([]);
  });

  it("leaves an unrelated editor listener running without spawning or signalling processes", async () => {
    const editor = await runtime({ checkout: join(root, "editor-project") });
    await expect(launcher.stopRuntime(undefined, endpointPath, launcher.REPO_ROOT))
      .rejects.toThrow("another launch location");
    expect(editor.commands).toEqual(["status__"]);
    expect(editor.server.listening).toBe(true);
    for (const guard of processGuards) expect(guard).not.toHaveBeenCalled();
  });
});
