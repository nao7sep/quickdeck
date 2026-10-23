import type { TextCounts } from "../types";

// Pane counts are O(text length): in a pane of a megabyte or more they would
// hold every keystroke for a noticeable time. They run in one shared worker
// instead, and each pane asks only for its newest text (latestOnly), so typing
// never waits and a burst of edits never queues a backlog of counts.

type Reply = { id: number; counts?: TextCounts; error?: string };
type Waiting = { resolve: (counts: TextCounts) => void; reject: (error: Error) => void };

let worker: Worker | null | undefined;
const waiting = new Map<number, Waiting>();
let nextId = 0;
function settleAll(error: Error) {
  const held = [...waiting.values()];
  waiting.clear();
  for (const request of held) request.reject(error);
}

// A worker that answered before dying is replaced on the next count. A failed
// startup stays unavailable until explicit retry, so typing never restarts it.
function countWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") return (worker = null);
  try {
    const created = new Worker(new URL("../workers/counts.worker.ts", import.meta.url), { type: "module" });
    let workerAnswered = false;
    created.onmessage = ({ data }: MessageEvent<Reply>) => {
      workerAnswered = true;
      const request = waiting.get(data.id);
      if (request === undefined) return;
      waiting.delete(data.id);
      if (data.counts !== undefined) request.resolve(data.counts);
      else request.reject(new Error(data.error ?? "count failed"));
    };
    created.onerror = (event) => {
      event.preventDefault();
      created.terminate();
      if (worker === created) worker = workerAnswered ? undefined : null;
      settleAll(new Error(event.message || "count worker failed"));
    };
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

export function countText(text: string): Promise<TextCounts> {
  const target = countWorker();
  if (target === null) return Promise.reject(new Error("count worker unavailable"));
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    try {
      target.postMessage({ id, text });
    } catch (error) {
      waiting.delete(id);
      reject(error);
    }
  });
}

// Retrying a failed startup must leave an available worker and its active
// counts alone; the requesting pane schedules its count again separately.
export function retryCountWorker(): void {
  if (worker === null) worker = undefined;
}

// Runs one input at a time; inputs submitted meanwhile collapse to the newest,
// which runs next. Every finished run is delivered, a failure as an Error.
export function latestOnly<I, R>(run: (input: I) => Promise<R>, deliver: (result: R | Error) => void): (input: I) => void {
  let busy = false;
  let pending: { input: I } | null = null;
  async function start(input: I) {
    busy = true;
    try {
      deliver(await run(input));
    } catch (error) {
      deliver(error instanceof Error ? error : new Error(String(error)));
    }
    const next = pending;
    pending = null;
    if (next === null) busy = false;
    else void start(next.input);
  }
  return (input) => {
    if (busy) pending = { input };
    else void start(input);
  };
}
