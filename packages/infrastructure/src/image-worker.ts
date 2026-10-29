import type pg from "pg";
import {
  ImageExecutor,
  type WorkItem,
  type CreationRepository,
  type ImageFiles,
  type ImageProvider,
} from "@tuyile/core";
export class ImageWorker {
  private lock: pg.PoolClient | undefined;
  private active = new Map<
    string,
    { task: WorkItem; controller: AbortController; promise: Promise<void> }
  >();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  private stopping = false;
  private healthy = false;
  constructor(
    private pool: pg.Pool,
    private repo: CreationRepository,
    private files: ImageFiles,
    private provider: ImageProvider,
    private fatal: () => void,
  ) {}
  async start() {
    this.lock = await this.pool.connect();
    const result = await this.lock.query(
      "SELECT pg_try_advisory_lock(72110404) acquired",
    );
    if (!result.rows[0].acquired) {
      this.lock.release();
      this.lock = undefined;
      throw new Error("WORKER_ALREADY_RUNNING");
    }
    this.lock.on("error", () => this.fail());
    this.lock.on("end", () => {
      if (!this.stopping) this.fail();
    });
    this.healthy = true;
    try {
      await this.repo.startWorker();
      await this.cleanup();
      this.timer = setInterval(() => {
        void this.tick();
      }, 250);
      await this.tick();
    } catch (error) {
      this.healthy = false;
      this.stopping = true;
      this.lock.release(true);
      this.lock = undefined;
      throw error;
    }
  }
  private fail() {
    if (!this.healthy) return;
    this.healthy = false;
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const a of this.active.values()) a.controller.abort();
    this.fatal();
  }
  private async cleanup() {
    for (const a of await this.repo.staleAssets()) {
      if (a.state === "staging" && !(await this.repo.abandonAsset(a))) continue;
      await this.files.remove(a.fileKey);
      await this.repo.finalizeDelete(a);
    }
  }
  private async tick() {
    if (this.ticking || this.stopping || !this.healthy) return;
    this.ticking = true;
    try {
      await this.lock!.query("SELECT 1");
      for (const a of this.active.values())
        if (await this.repo.stopRequested(a.task)) a.controller.abort();
      while (this.healthy && !this.stopping) {
        const task = await this.repo.claim(
          [...this.active.values()].map((v) => v.task.userId),
          this.active.size,
        );
        if (!task) break;
        const controller = new AbortController(),
          signal = AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(
              Math.max(1, task.deadline.getTime() - Date.now()),
            ),
          ]);
        const promise = new ImageExecutor(this.repo, this.files, {
          generate: (...args) => {
            if (!this.healthy || (this.stopping && controller.signal.aborted))
              throw new Error("WORKER_STOPPED");
            return this.provider.generate(...args);
          },
        })
          .execute(task, signal)
          .catch(() => this.fail())
          .finally(() => this.active.delete(task.id));
        this.active.set(task.id, { task, controller, promise });
      }
      await this.cleanup();
    } catch {
      this.fail();
    } finally {
      this.ticking = false;
    }
  }
  async stop(timeout = 10000) {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    const pending = Promise.all(
      [...this.active.values()].map((v) => v.promise),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      pending,
      new Promise<void>((r) => {
        timer = setTimeout(() => {
          for (const a of this.active.values()) a.controller.abort();
          r();
        }, timeout);
      }),
    ]);
    if (timer) clearTimeout(timer);
    await Promise.allSettled([...this.active.values()].map((v) => v.promise));
    this.healthy = false;
    if (this.lock) {
      await this.lock
        .query("SELECT pg_advisory_unlock(72110404)")
        .catch(() => {});
      this.lock.release();
      this.lock = undefined;
    }
  }
}
