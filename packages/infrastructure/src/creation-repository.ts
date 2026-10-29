import { PgOutputsRepository } from "./creation/outputs.js";
import pg from "pg";
import type {
  CreationStore,
  CreationLock,
  CreationUnitOfWork,
} from "@tuyile/core";
import { PgTransactions } from "./transactions.js";
import { PgTasksRepository } from "./creation/tasks.js";
import { PgAssetsRepository } from "./creation/assets.js";
import { PgQuotaRepository } from "./creation/quota.js";
import { PgProvidersRepository } from "./creation/providers.js";
import { PgExecutionRepository } from "./creation/execution.js";
export class PgCreationStore implements CreationStore {
  private readonly transactions: PgTransactions;
  constructor(
    pool: pg.Pool,
    private readonly masterKey: string,
    private readonly fakeAllowed = false,
    private readonly now = () => new Date(),
  ) {
    if (!/^[a-f0-9]{64}$/.test(masterKey))
      throw new Error("APP_MASTER_KEY_REQUIRED");
    this.transactions = new PgTransactions(pool);
  }
  private scope(c: pg.PoolClient): CreationUnitOfWork {
    return {
      outputs: new PgOutputsRepository(
        c,
        this.masterKey,
        this.fakeAllowed,
        this.now,
      ),
      tasks: new PgTasksRepository(
        c,
        this.masterKey,
        this.fakeAllowed,
        this.now,
      ),
      assets: new PgAssetsRepository(
        c,
        this.masterKey,
        this.fakeAllowed,
        this.now,
      ),
      quota: new PgQuotaRepository(
        c,
        this.masterKey,
        this.fakeAllowed,
        this.now,
      ),
      providers: new PgProvidersRepository(
        c,
        this.masterKey,
        this.fakeAllowed,
        this.now,
      ),
      execution: new PgExecutionRepository(
        c,
        this.masterKey,
        this.fakeAllowed,
        this.now,
      ),
    };
  }
  read<T>(run: (r: CreationUnitOfWork) => Promise<T>) {
    return this.transactions.read((c) => run(this.scope(c)));
  }
  write<T>(lock: CreationLock, run: (r: CreationUnitOfWork) => Promise<T>) {
    return this.transactions.write(
      (c) => run(this.scope(c)),
      async (c) => {
        const owners = [...lock.owners];
        if (lock.taskId)
          owners.push(
            ...(
              await c.query("SELECT user_id FROM image_tasks WHERE id=$1", [
                lock.taskId,
              ])
            ).rows.map((r) => r.user_id),
          );
        if (lock.attemptId)
          owners.push(
            ...(
              await c.query(
                "SELECT t.user_id FROM image_attempts a JOIN image_tasks t ON t.id=a.task_id WHERE a.id=$1",
                [lock.attemptId],
              )
            ).rows.map((r) => r.user_id),
          );
        if (lock.taskState)
          owners.push(
            ...(
              await c.query(
                "SELECT DISTINCT user_id FROM image_tasks WHERE state=$1",
                [lock.taskState],
              )
            ).rows.map((r) => r.user_id),
          );
        return owners;
      },
      lock.queue,
    );
  }
}
