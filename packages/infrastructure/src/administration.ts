import type pg from "pg";
import {
  AppError,
  shanghaiDay,
  type AdministrationRepository,
  type AdministrationStore,
} from "@tuyile/core";
import type {
  Principal,
  ExecutionSettings,
  PlanningPolicy,
  AdminSummary,
} from "@tuyile/contracts";
import { PgCreationContext } from "./creation/context.js";
import { PgTransactions } from "./transactions.js";
class PgAdministrationRepository
  extends PgCreationContext
  implements AdministrationRepository
{
  async settings(p: Principal) {
    await this.auth(this.c, p, true, false);
    const images = (
        await this.c.query("SELECT * FROM image_settings WHERE id=1")
      ).rows[0],
      planning = (
        await this.c.query("SELECT * FROM planning_settings WHERE id=1")
      ).rows[0];
    return {
      images: {
        concurrency: images.concurrency,
        queueLimit: images.queue_limit,
      },
      planning: {
        concurrency: planning.concurrency,
        queueLimit: planning.queue_limit,
      },
    };
  }
  async saveSettings(p: Principal, input: ExecutionSettings) {
    await this.auth(this.c, p, true);
    await this.c.query(
      "UPDATE image_settings SET concurrency=$1,queue_limit=$2 WHERE id=1",
      [input.images.concurrency, input.images.queueLimit],
    );
    await this.c.query(
      "UPDATE planning_settings SET concurrency=$1,queue_limit=$2 WHERE id=1",
      [input.planning.concurrency, input.planning.queueLimit],
    );
    await this.c.query(
      "INSERT INTO administration_audit(actor_id,action,values) VALUES($1,'execution-settings',$2)",
      [p.id, input],
    );
  }
  private async target(p: Principal, id: string) {
    await this.auth(this.c, p, true, false);
    if (
      !(await this.c.query("SELECT id FROM users WHERE id=$1", [id])).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
  }
  async policy(p: Principal, id: string) {
    await this.target(p, id);
    const row = (
      await this.c.query("SELECT * FROM planning_policies WHERE user_id=$1", [
        id,
      ])
    ).rows[0];
    return {
      dailyLimit: row?.daily_limit ?? 50,
      concurrency: row?.concurrency ?? 1,
      queueLimit: row?.queue_limit ?? 10,
      ...(row?.allowed_models?.length
        ? { allowedModels: row.allowed_models }
        : {}),
    };
  }
  async savePolicy(p: Principal, id: string, input: PlanningPolicy) {
    await this.target(p, id);
    await this.c.query(
      "INSERT INTO planning_policies(user_id,daily_limit,concurrency,queue_limit,allowed_models) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET daily_limit=excluded.daily_limit,concurrency=excluded.concurrency,queue_limit=excluded.queue_limit,allowed_models=excluded.allowed_models",
      [
        id,
        input.dailyLimit,
        input.concurrency,
        input.queueLimit,
        JSON.stringify(input.allowedModels ?? []),
      ],
    );
    await this.c.query(
      "INSERT INTO administration_audit(actor_id,target_id,action,values) VALUES($1,$2,'planning-policy',$3)",
      [p.id, id, input],
    );
  }
  async summary(p: Principal): Promise<AdminSummary> {
    await this.auth(this.c, p, true, false);
    const day = shanghaiDay(this.now());
    const imageStates = Object.fromEntries(
      (
        await this.c.query(
          "SELECT state,count(*) n FROM image_tasks GROUP BY state",
        )
      ).rows.map((r) => [r.state, Number(r.n)]),
    );
    const planningStates = Object.fromEntries(
      (
        await this.c.query(
          "SELECT state,count(*) n FROM planning_jobs GROUP BY state",
        )
      ).rows.map((r) => [r.state, Number(r.n)]),
    );
    const images = (
      await this.c.query(
        "SELECT coalesce(sum(used),0) used,coalesce(sum(held),0) held,coalesce(sum(attempts),0) attempts FROM image_days WHERE day=$1",
        [day],
      )
    ).rows[0];
    const planning = (
      await this.c.query(
        "SELECT coalesce(sum(used),0) used,coalesce(sum(held),0) held FROM planning_days WHERE day=$1",
        [day],
      )
    ).rows[0];
    const calls = (
      await this.c.query(
        "SELECT count(*) n,count(*) FILTER(WHERE input_tokens IS NULL OR output_tokens IS NULL) unknown FROM planning_attempts WHERE created_at>=$1::date AT TIME ZONE 'Asia/Shanghai' AND created_at<($1::date+1) AT TIME ZONE 'Asia/Shanghai'",
        [day],
      )
    ).rows[0];
    const storage = (
      await this.c.query(
        "SELECT coalesce(sum(storage_used),0) used,coalesce(sum(storage_reserved),0) reserved FROM image_policies",
      )
    ).rows[0];
    const counters = (
      await this.c
        .query(`SELECT (SELECT count(*) FROM image_tasks WHERE pending_review) pending_review,
   (SELECT count(*) FROM image_quota_reconciliation WHERE used<>ledger_used OR held<>ledger_held) image_days,
   (SELECT count(*) FROM image_reservation_reconciliation WHERE consumed<>task_used OR held<>task_held OR consumed<>ledger_used OR held<>ledger_held) image_reservations,
   (SELECT count(*) FROM planning_quota_reconciliation WHERE used<>job_used OR held<>job_held) planning_days`)
    ).rows[0];
    const errors = (
      await this.c.query(
        "SELECT id,user_id,'image' kind,error_code,created_at FROM image_tasks WHERE error_code IS NOT NULL UNION ALL SELECT id,user_id,'planning',error_code,created_at FROM planning_jobs WHERE error_code IS NOT NULL ORDER BY created_at DESC LIMIT 50",
      )
    ).rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      kind: r.kind,
      code: r.error_code,
      createdAt: r.created_at.toISOString(),
    }));
    const audits = (
      await this.c.query(
        "SELECT id,actor_id,target_id,action,created_at FROM administration_audit UNION ALL SELECT id,actor_id,NULL::uuid,'image-resolution',created_at FROM image_audit ORDER BY created_at DESC LIMIT 50",
      )
    ).rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      targetId: r.target_id,
      action: r.action,
      createdAt: r.created_at.toISOString(),
    }));
    return {
      imageStates,
      planningStates,
      today: {
        imagesUsed: Number(images.used),
        imagesHeld: Number(images.held),
        planningUsed: Number(planning.used),
        planningHeld: Number(planning.held),
        imageAttempts: Number(images.attempts),
        planningCalls: Number(calls.n),
        unknownPlanningUsage: Number(calls.unknown),
      },
      storage: {
        used: Number(storage.used),
        reserved: Number(storage.reserved),
      },
      pendingReview: Number(counters.pending_review),
      reconciliation: {
        imageDays: Number(counters.image_days),
        imageReservations: Number(counters.image_reservations),
        planningDays: Number(counters.planning_days),
      },
      errors,
      audits,
    };
  }
}
export class PgAdministrationStore implements AdministrationStore {
  private readonly transactions: PgTransactions;
  constructor(pool: pg.Pool) {
    this.transactions = new PgTransactions(pool);
  }
  read<T>(run: (r: AdministrationRepository) => Promise<T>) {
    return this.transactions.read((c) =>
      run(new PgAdministrationRepository(c, "")),
    );
  }
  write<T>(owners: string[], run: (r: AdministrationRepository) => Promise<T>) {
    return this.transactions.write(
      (c) => run(new PgAdministrationRepository(c, "")),
      owners,
      true,
    );
  }
}
