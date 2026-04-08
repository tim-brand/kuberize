export class ReconcileQueue {
  private timers: Map<string, Timer> = new Map();
  private running: Map<string, boolean> = new Map();
  private dirty: Map<string, boolean> = new Map();

  constructor(private handler: (key: string) => Promise<void>) {}

  enqueue(key: string) {
    const existingTimer = this.timers.get(key);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }

    if (this.running.get(key)) {
      this.dirty.set(key, true);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.run(key);
    }, 500);

    this.timers.set(key, timer);
  }

  private async run(key: string) {
    this.running.set(key, true);
    this.dirty.set(key, false);

    const delays = [1000, 2000, 4000, 8000, 16000, 30000];
    let lastError: unknown;

    for (let attempt = 0; attempt < delays.length; attempt++) {
      try {
        await this.handler(key);
        this.running.set(key, false);
        if (this.dirty.get(key)) {
          this.enqueue(key);
        }
        return;
      } catch (err) {
        lastError = err;
        const delay = delays[attempt];
        console.error(
          `[ReconcileQueue] Retry attempt ${attempt + 1} for key "${key}" in ${delay}ms:`,
          err,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.running.set(key, false);
    console.error(
      `[ReconcileQueue] All retries exhausted for key "${key}". Giving up.`,
      lastError,
    );
  }
}
