import {
  PlanningExecutor,
  type AgentService,
  type PlanningProvider,
  type PlanningWork,
} from "@tuyile/core";
export class PlanningLane {
  private active = new Map<
    string,
    { work: PlanningWork; controller: AbortController; promise: Promise<void> }
  >();
  constructor(
    private readonly service: AgentService,
    private readonly provider: PlanningProvider,
  ) {}
  start() {
    return this.service.startWorker();
  }
  abort() {
    for (const item of this.active.values()) item.controller.abort();
  }
  async tick(healthy: () => boolean, fatal: () => void) {
    for (const item of this.active.values())
      if (!(await this.service.ready(item.work))) item.controller.abort();
    while (healthy()) {
      const work = await this.service.claim(
        [...this.active.values()].map((a) => a.work.userId),
      );
      if (!work) return;
      if (!healthy()) {
        await this.service.finish(work, undefined, "PLANNING_INTERRUPTED");
        return;
      }
      const controller = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(
          Math.min(120000, Math.max(1, work.deadline.getTime() - Date.now())),
        ),
      ]);
      const promise = new PlanningExecutor(this.service, {
        complete: (...args) => {
          if (!healthy()) throw new Error("WORKER_STOPPED");
          return this.provider.complete(...args);
        },
      })
        .execute(work, signal)
        .catch(fatal)
        .finally(() => this.active.delete(work.id));
      this.active.set(work.id, { work, controller, promise });
    }
  }
  async stop(timeout = 10000) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([...this.active.values()].map((a) => a.promise)),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            this.abort();
            resolve();
          }, timeout);
        }),
      ]);
      await Promise.allSettled([...this.active.values()].map((a) => a.promise));
    } finally {
      clearTimeout(timer);
    }
  }
}
