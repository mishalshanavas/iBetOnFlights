// Bound concurrent provider requests; discard queued work when its view is removed.
export function createRequestQueue(concurrency: number) {
  let active = 0;
  const pending: Array<() => void> = [];
  const drain = () => {
    while (active < concurrency && pending.length) pending.shift()!();
  };
  return function schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = pending.indexOf(start);
        if (index >= 0) pending.splice(index, 1);
        reject(signal?.reason ?? new DOMException("Request cancelled", "AbortError"));
      };
      const start = () => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) { abort(); return; }
        active++;
        Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; drain(); });
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      pending.push(start);
      drain();
    });
  };
}
