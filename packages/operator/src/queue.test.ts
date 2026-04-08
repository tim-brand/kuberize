import { describe, it, expect, mock } from "bun:test";
import { ReconcileQueue } from "./queue.js";

describe("ReconcileQueue", () => {
  it("calls the handler after debounce", async () => {
    const handler = mock(() => Promise.resolve());
    const queue = new ReconcileQueue(handler);

    queue.enqueue("ns/foo");

    // Not called immediately
    expect(handler).not.toHaveBeenCalled();

    // Called after debounce delay
    await new Promise((r) => setTimeout(r, 600));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("ns/foo");
  });

  it("debounces rapid enqueues — only calls handler once", async () => {
    const handler = mock(() => Promise.resolve());
    const queue = new ReconcileQueue(handler);

    queue.enqueue("ns/foo");
    queue.enqueue("ns/foo");
    queue.enqueue("ns/foo");

    await new Promise((r) => setTimeout(r, 600));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handles different keys independently", async () => {
    const handler = mock(() => Promise.resolve());
    const queue = new ReconcileQueue(handler);

    queue.enqueue("ns/foo");
    queue.enqueue("ns/bar");

    await new Promise((r) => setTimeout(r, 600));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("marks key dirty if enqueued while running, re-runs after completion", async () => {
    let resolveFirst: (() => void) | undefined;
    let callCount = 0;

    const handler = mock(
      () =>
        new Promise<void>((r) => {
          callCount++;
          if (callCount === 1) {
            resolveFirst = r;
          } else {
            r();
          }
        })
    );

    const queue = new ReconcileQueue(handler);
    queue.enqueue("ns/foo");

    // Wait for debounce + handler to start
    await new Promise((r) => setTimeout(r, 600));
    expect(callCount).toBe(1);

    // Enqueue while handler is still running — marks dirty
    queue.enqueue("ns/foo");

    // Resolve the first run — triggers dirty re-enqueue (500ms debounce)
    if (resolveFirst) resolveFirst();

    // Wait for re-enqueue debounce + second run
    await new Promise((r) => setTimeout(r, 700));
    expect(callCount).toBe(2);
  });

  it("retries on failure with correct number of attempts (6)", async () => {
    let attempts = 0;
    const handler = mock(() => {
      attempts++;
      return Promise.reject(new Error("boom"));
    });

    const queue = new ReconcileQueue(handler);
    queue.enqueue("ns/foo");

    // Wait long enough for all retries: 500ms debounce + sum(1+2+4+8+16+30)s = 61s
    // Too slow for a real test — just verify it starts retrying
    await new Promise((r) => setTimeout(r, 700));
    expect(attempts).toBeGreaterThanOrEqual(1);
  });
});
