// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const countOnUiThread = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/counts", () => ({ getTextCounts: countOnUiThread }));

afterEach(() => {
  countOnUiThread.mockClear();
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

  it("requires explicit retry if a replacement worker cannot start", async () => {
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
    const { countText } = await import("../../src/services/textCounts");
    const first = countText("one");
    FakeWorker.created[0].reply({ id: FakeWorker.created[0].posted[0].id, counts: { words: 1 } });
    await first;
    FakeWorker.created[0].die();
    const replacementCount = countText("two");
    FakeWorker.created[1].die();
    await expect(replacementCount).rejects.toThrow("worker crashed");
    await expect(countText("three")).rejects.toThrow("unavailable");
    expect(FakeWorker.created).toHaveLength(2);
    expect(countOnUiThread).not.toHaveBeenCalled();
  });

  it("rejects every pending count on startup failure and waits for explicit retry", async () => {
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
    const { countText, retryCountWorker } = await import("../../src/services/textCounts");
    const first = countText("hello world");
    const second = countText("another pane");
    FakeWorker.created[0].die();
    await expect(first).rejects.toThrow("worker crashed");
    await expect(second).rejects.toThrow("worker crashed");
    await expect(countText("one")).rejects.toThrow("unavailable");
    expect(FakeWorker.created).toHaveLength(1);
    expect(countOnUiThread).not.toHaveBeenCalled();

    retryCountWorker();
    const retried = countText("hello world");
    expect(FakeWorker.created).toHaveLength(2);
    const replacement = FakeWorker.created[1];
    replacement.reply({ id: replacement.posted[0].id, counts: { words: 2, chars: 11 } });
    await expect(retried).resolves.toMatchObject({ words: 2, chars: 11 });
    expect(countOnUiThread).not.toHaveBeenCalled();
  });

  it("rejects without UI counting where there are no workers", async () => {
    vi.stubGlobal("Worker", undefined);
    const { countText, retryCountWorker } = await import("../../src/services/textCounts");
    await expect(countText("hello world")).rejects.toThrow("unavailable");
    retryCountWorker();
    await expect(countText("hello world")).rejects.toThrow("unavailable");
    expect(countOnUiThread).not.toHaveBeenCalled();
  });

  it("remembers a constructor failure and can retry it", async () => {
    const construct = vi.fn(function () { throw new Error("startup blocked"); });
    vi.stubGlobal("Worker", construct);
    const { countText, retryCountWorker } = await import("../../src/services/textCounts");
    await expect(countText("one")).rejects.toThrow("unavailable");
    await expect(countText("two")).rejects.toThrow("unavailable");
    expect(construct).toHaveBeenCalledTimes(1);
    expect(countOnUiThread).not.toHaveBeenCalled();
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
    retryCountWorker();
    const retried = countText("two");
    const replacement = FakeWorker.created[0];
    replacement.reply({ id: replacement.posted[0].id, counts: { words: 1 } });
    await expect(retried).resolves.toMatchObject({ words: 1 });
  });

  it("leaves a healthy worker and its pending counts alone when retry is requested", async () => {
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
    const { countText, retryCountWorker } = await import("../../src/services/textCounts");
    const pending = countText("one");
    retryCountWorker();
    const other = countText("two");
    const worker = FakeWorker.created[0];
    expect(FakeWorker.created).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    worker.reply({ id: worker.posted[0].id, counts: { words: 1 } });
    worker.reply({ id: worker.posted[1].id, counts: { words: 2 } });
    await expect(pending).resolves.toMatchObject({ words: 1 });
    await expect(other).resolves.toMatchObject({ words: 2 });
  });

  it("rejects a postMessage failure and allows later requests on the same worker", async () => {
    FakeWorker.created = [];
    vi.stubGlobal("Worker", FakeWorker);
    const { countText } = await import("../../src/services/textCounts");
    const first = countText("one");
    const worker = FakeWorker.created[0];
    vi.spyOn(worker, "postMessage").mockImplementationOnce(() => { throw new Error("cannot send"); });
    await expect(countText("bad")).rejects.toThrow("cannot send");
    const next = countText("two");
    worker.reply({ id: worker.posted[0].id, counts: { words: 1 } });
    worker.reply({ id: worker.posted[1].id, counts: { words: 2 } });
    await expect(first).resolves.toMatchObject({ words: 1 });
    await expect(next).resolves.toMatchObject({ words: 2 });
    expect(FakeWorker.created).toHaveLength(1);
  });
});
