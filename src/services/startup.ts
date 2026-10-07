// The required startup load has one visible deadline; native volume I/O can
// finish later, but that result cannot authorize adopting authored state.
export const STARTUP_LOAD_BOUND_MS = 10_000;

export async function awaitStartup<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Startup load did not finish in time.")), Math.max(0, deadline - Date.now()));
    })]);
  } finally { clearTimeout(timer); }
}
