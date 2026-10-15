// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("latestOnly", () => {
  it("runs one count at a time and collapses waiting texts to the newest", async () => {
    const { latestOnly } = await import("../../src/services/textCounts");
    const runs: { input: string; done: ReturnType<typeof deferred<string>> }[] = [];
    const delivered: (string | Error)[] = [];
    const submit = latestOnly(
      (input: string) => {
        const done = deferred<string>();
        runs.push({ input, done });
        return done.promise;
      },
      (result) => delivered.push(result),
    );

    submit("a");
    submit("ab");
    submit("abc");
    expect(runs.map((run) => run.input)).toEqual(["a"]);

    runs[0].done.resolve("counted a");
    await vi.waitFor(() => expect(runs.map((run) => run.input)).toEqual(["a", "abc"]));
    runs[1].done.resolve("counted abc");
    await vi.waitFor(() => expect(delivered).toEqual(["counted a", "counted abc"]));
  });

  it("delivers a failed count as an error and keeps counting later texts", async () => {
    const { latestOnly } = await import("../../src/services/textCounts");
    const delivered: (string | Error)[] = [];
    const submit = latestOnly(
      (input: string) => (input === "bad" ? Promise.reject(new Error("out of memory")) : Promise.resolve(input)),
      (result) => delivered.push(result),
    );
    submit("bad");
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    submit("good");
    await vi.waitFor(() => expect(delivered).toHaveLength(2));
    expect(delivered[0]).toBeInstanceOf(Error);
    expect(delivered[1]).toBe("good");
  });
});

// A stand-in for the counting worker: replies are routed by request id, and a
// worker that dies fails what it held and is replaced on the next count.
class FakeWorker {
  static created: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
  posted: { id: number; text: string }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.created.push(this);
  }
  postMessage(message: { id: number; text: string }) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
  die() {
    this.onerror?.({ message: "worker crashed", preventDefault: () => undefined });
  }
}

describe("countText", () => {
  it("counts in the worker and routes each reply to its request", async () => {
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
    const { countText } = await import("../../src/services/textCounts");
    const first = countText("one");
    const second = countText("two words");
    const worker = FakeWorker.created[0];
    const counts = { words: 2, chars: 9, xWeightedChars: 9, xLimit: 280, xValid: true };
    worker.reply({ id: worker.posted[1].id, counts });
    worker.reply({ id: worker.posted[0].id, error: "too large" });
    await expect(second).resolves.toEqual(counts);
    await expect(first).rejects.toThrow("too large");
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("fails what a dying worker held and starts a fresh one for the next count", async () => {
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
    const { countText } = await import("../../src/services/textCounts");
    // The worker has answered before, so it runs here; this count killed it.
    const earlier = countText("small");
    FakeWorker.created[0].reply({ id: FakeWorker.created[0].posted[0].id, counts: { words: 1 } });
    await earlier;
    const pending = countText("huge");
    FakeWorker.created[0].die();
    await expect(pending).rejects.toThrow("worker crashed");
    expect(FakeWorker.created[0].terminated).toBe(true);

    void countText("next");
    expect(FakeWorker.created).toHaveLength(2);
  });

  it("counts on the page for the session when the worker cannot start here", async () => {
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
    const { countText } = await import("../../src/services/textCounts");
    const pending = countText("hello world");
    FakeWorker.created[0].die();
    await expect(pending).resolves.toMatchObject({ words: 2, chars: 11 });
    await expect(countText("one")).resolves.toMatchObject({ words: 1 });
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("counts on the page, after the current task, where there are no workers", async () => {
    vi.stubGlobal("Worker", undefined);
    const { countText } = await import("../../src/services/textCounts");
    await expect(countText("hello world")).resolves.toMatchObject({ words: 2, chars: 11 });
  });
});
