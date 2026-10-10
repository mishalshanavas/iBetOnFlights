import { describe, expect, it } from "vitest";
import { createRequestQueue } from "@/lib/request-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("provider request queue", () => {
  it("limits active requests and advances waiting requests when one finishes", async () => {
    const queue = createRequestQueue(2), tasks = Array.from({ length: 4 }, () => deferred<number>());
    const started: number[] = [];
    const results = tasks.map((task, i) => queue(() => { started.push(i); return task.promise; }));
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    tasks[0].resolve(10);
    await results[0];
    await new Promise(done => setTimeout(done, 0));
    expect(started).toEqual([0, 1, 2]);
    tasks[1].resolve(11); tasks[2].resolve(12);
    await new Promise(done => setTimeout(done, 0));
    expect(started).toEqual([0, 1, 2, 3]);
    tasks[3].resolve(13);
    expect(await Promise.all(results)).toEqual([10, 11, 12, 13]);
  });

  it("removes cancelled waiting requests without blocking the following request", async () => {
    const queue = createRequestQueue(1), first = deferred<number>(), controller = new AbortController();
    const started: string[] = [];
    const running = queue(() => first.promise);
    const cancelled = queue(async () => { started.push("cancelled"); return 2; }, controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const following = queue(async () => { started.push("following"); return 3; });
    controller.abort();
    await rejected;
    first.resolve(1);
    await running;
    expect(await following).toBe(3);
    expect(started).toEqual(["following"]);
  });

  it("releases capacity after a provider failure", async () => {
    const queue = createRequestQueue(1);
    const failed = queue(async () => { throw new Error("provider unavailable"); });
    const rejected = expect(failed).rejects.toThrow("provider unavailable");
    const following = queue(async () => "recovered");
    await rejected;
    expect(await following).toBe("recovered");
  });
});
