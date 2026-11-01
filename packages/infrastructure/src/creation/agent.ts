import { createHash } from "node:crypto";
import {
  AppError,
  shanghaiDay,
  type AgentRepository,
  type PlanningMessages,
  type PlanningWork,
  type PlanningReply,
} from "@tuyile/core";
import {
  agentPlan,
  type AgentPlan,
  type Principal,
  type PlanningRequest,
  type PlanningJob,
  type AgentPlanVersion,
  type PlanRevisionInput,
} from "@tuyile/contracts";
import { PgCreationContext, asset } from "./context.js";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class PgAgentRepository
  extends PgCreationContext
  implements AgentRepository
{
  async references(work: PlanningWork) {
    if (!(await this.ready(work))) throw new AppError("PLANNING_STOPPED", 409);
    const rows = (
      await this.c.query(
        "SELECT a.* FROM agent_references r JOIN image_assets a ON a.workspace_id=r.workspace_id AND a.id=r.asset_id JOIN planning_jobs j ON j.workspace_id=r.workspace_id AND j.id=r.job_id WHERE j.id=$1 AND j.user_id=$2 ORDER BY a.id",
        [work.id, work.userId],
      )
    ).rows;
    if (rows.some((row) => row.state !== "ready"))
      throw new AppError("REFERENCE_UNAVAILABLE", 409);
    return rows.map(asset);
  }

  async context(p: Principal, id: string) {
    const { plan } = await this.plan(p, id);
    const row = (
      await this.c.query("SELECT messages FROM planning_jobs WHERE id=$1", [
        plan.jobId,
      ])
    ).rows[0];
    const referenceIds = (
      await this.c.query(
        "SELECT asset_id FROM agent_references WHERE job_id=$1 ORDER BY asset_id",
        [plan.jobId],
      )
    ).rows.map((r) => r.asset_id as string);
    return {
      document: plan.document,
      messages: row.messages as PlanningMessages[],
      referenceIds,
    };
  }
  async clearHistory(p: Principal, project: string) {
    await this.project(p, project);
    if (
      (
        await this.c.query(
          "SELECT 1 FROM planning_jobs WHERE workspace_id=$1 AND project_id=$2 AND state IN ('queued','running') UNION ALL SELECT 1 FROM image_tasks WHERE workspace_id=$1 AND project_id=$2 AND (state IN ('queued','running') OR pending_review) LIMIT 1",
          [p.workspaceId, project],
        )
      ).rowCount
    )
      throw new AppError("PROJECT_BUSY", 409);
    await this.c.query(
      "DELETE FROM agent_references WHERE job_id IN (SELECT id FROM planning_jobs WHERE workspace_id=$1 AND project_id=$2)",
      [p.workspaceId, project],
    );
    await this.c.query(
      "UPDATE agent_plans SET document='{}'::jsonb WHERE job_id IN (SELECT id FROM planning_jobs WHERE workspace_id=$1 AND project_id=$2)",
      [p.workspaceId, project],
    );
    await this.c.query(
      "UPDATE planning_jobs SET archived=true,input='{}'::jsonb,messages='[]'::jsonb WHERE workspace_id=$1 AND project_id=$2",
      [p.workspaceId, project],
    );
  }
  async cancelJob(p: Principal, id: string) {
    await this.auth(this.c, p);
    const row = (
      await this.c.query(
        "SELECT * FROM planning_jobs WHERE workspace_id=$1 AND id=$2 AND NOT archived FOR UPDATE",
        [p.workspaceId, id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    if (!["queued", "running"].includes(row.state)) return;
    await this.c.query(
      "UPDATE planning_jobs SET cancel_requested=true WHERE id=$1",
      [id],
    );
    if (row.state === "queued")
      await this.finish(
        {
          id: row.id,
          userId: row.user_id,
          providerId: row.provider_id,
          skillId: row.skill_id,
          messages: row.messages,
          deadline: row.deadline,
        },
        undefined,
        "CANCELLED",
      );
  }
  async plan(p: Principal, id: string) {
    await this.auth(this.c, p);
    const row = (
      await this.c.query(
        "SELECT a.*,j.project_id,j.skill_id,j.provider_id,j.input AS job_input FROM agent_plans a JOIN planning_jobs j ON j.id=a.job_id WHERE a.workspace_id=$1 AND a.id=$2 AND NOT j.archived FOR UPDATE OF a",
        [p.workspaceId, id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    await this.project(p, row.project_id);
    const taskIds = (
      await this.c.query(
        "SELECT id FROM image_tasks WHERE agent_plan_id=$1 ORDER BY step_index",
        [id],
      )
    ).rows.map((r) => r.id);
    return {
      plan: {
        id: row.id,
        jobId: row.job_id,
        version: row.version,
        document: agentPlan.parse(row.document),
        confirmed: !!row.confirmed_at,
        taskIds,
      },
      projectId: row.project_id,
      skillId: row.skill_id,
      providerId: row.provider_id,
      textSources: row.job_input?.textSources ?? [],
    };
  }
  async attach(
    plan: string,
    task: string,
    index: number,
    previous: string | null,
  ) {
    await this.c.query(
      "UPDATE image_tasks SET agent_plan_id=$2,step_index=$3,depends_on=$4 WHERE id=$1",
      [task, plan, index, previous],
    );
  }
  async confirm(id: string) {
    await this.c.query(
      "UPDATE agent_plans SET confirmed_at=$2 WHERE id=$1 AND confirmed_at IS NULL",
      [id, this.now()],
    );
  }
  async interrupt() {
    const rows = (
      await this.c.query(
        "SELECT * FROM planning_jobs WHERE state='running' FOR UPDATE",
      )
    ).rows;
    for (const row of rows)
      await this.finish(
        {
          id: row.id,
          userId: row.user_id,
          providerId: row.provider_id,
          skillId: row.skill_id,
          messages: row.messages,
          deadline: row.deadline,
        },
        undefined,
        "WORKER_INTERRUPTED",
      );
    await this.c.query(
      "UPDATE planning_attempts SET state='unknown',error_code='WORKER_INTERRUPTED' WHERE state='dispatched'",
    );
  }
  async claim(activeUsers: string[]) {
    const settings = (
      await this.c.query("SELECT concurrency FROM planning_settings WHERE id=1")
    ).rows[0];
    if (activeUsers.length >= settings.concurrency) return null;
    const rows = (
      await this.c.query(
        "SELECT j.*,u.enabled,u.execution_version AS current_version,coalesce(p.concurrency,1) AS concurrency FROM planning_jobs j JOIN users u ON u.id=j.user_id LEFT JOIN planning_policies p ON p.user_id=j.user_id WHERE j.state='queued' ORDER BY j.created_at,j.id LIMIT 100",
      )
    ).rows;
    for (const row of rows) {
      const work: PlanningWork = {
        id: row.id,
        userId: row.user_id,
        providerId: row.provider_id,
        skillId: row.skill_id,
        messages: row.messages,
        deadline: row.deadline,
      };
      if (
        !row.enabled ||
        row.current_version !== row.execution_version ||
        row.cancel_requested ||
        row.deadline <= this.now()
      ) {
        await this.finish(work, undefined, "AUTHORIZATION_REVOKED");
        continue;
      }
      if (
        activeUsers.filter((id) => id === row.user_id).length >= row.concurrency
      )
        continue;
      await this.c.query(
        "UPDATE planning_jobs SET state='running' WHERE id=$1",
        [row.id],
      );
      return work;
    }
    return null;
  }
  async ready(work: PlanningWork) {
    return !!(
      await this.c.query(
        "SELECT 1 FROM planning_jobs j JOIN users u ON u.id=j.user_id JOIN planning_provider_versions p ON p.id=j.provider_id LEFT JOIN skill_versions s ON s.id=j.skill_id WHERE j.id=$1 AND j.state='running' AND NOT j.cancel_requested AND u.enabled AND u.execution_version=j.execution_version AND NOT p.revoked AND NOT coalesce(s.revoked,false) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(s.definition->'tools','[]'::jsonb)) dep LEFT JOIN tool_controls tc ON tc.tool_id=dep->>'id' AND tc.version=(dep->>'version')::integer WHERE tc.tool_id IS NULL OR tc.revoked) AND j.deadline>$2",
        [work.id, this.now()],
      )
    ).rowCount;
  }
  async dispatch(work: PlanningWork, requested: number) {
    const row = (
      await this.c.query("SELECT * FROM planning_jobs WHERE id=$1 FOR UPDATE", [
        work.id,
      ])
    ).rows[0];
    if (
      !row ||
      row.state !== "running" ||
      row.calls >= 3 ||
      row.remaining_tokens < 1
    )
      throw new AppError("PLANNING_BUDGET_EXCEEDED", 409);
    const budget = Math.min(
      requested || Math.ceil(row.remaining_tokens / 2),
      row.remaining_tokens,
    );
    if (!Number.isInteger(budget) || budget < 1)
      throw new AppError("PLANNING_BUDGET_EXCEEDED", 409);
    if (!row.charged)
      await this.c.query(
        "UPDATE planning_days SET held=held-1,used=used+1 WHERE user_id=$1 AND day=$2",
        [row.user_id, row.day],
      );
    await this.c.query(
      "UPDATE planning_jobs SET charged=true,calls=calls+1,remaining_tokens=remaining_tokens-$2 WHERE id=$1",
      [work.id, budget],
    );
    const attempt = (
      await this.c.query(
        "INSERT INTO planning_attempts(job_id,ordinal,requested_tokens,state) VALUES($1,$2,$3,'dispatched') RETURNING id",
        [work.id, row.calls + 1, budget],
      )
    ).rows[0];
    return { attemptId: attempt.id, budget };
  }
  async attemptResult(
    id: string,
    state: "received" | "rejected" | "unknown",
    reply?: PlanningReply,
    code?: string,
  ) {
    const row = (
      await this.c.query(
        "UPDATE planning_attempts SET state=$2,input_tokens=$3,output_tokens=$4,error_code=$5 WHERE id=$1 AND state='dispatched' RETURNING *",
        [
          id,
          state,
          reply?.inputTokens ?? null,
          reply?.outputTokens ?? null,
          code ?? null,
        ],
      )
    ).rows[0];
    if (!row) return;
    const refund =
      state === "rejected"
        ? row.requested_tokens
        : state === "received" &&
            reply?.outputTokens !== null &&
            reply?.outputTokens !== undefined
          ? row.requested_tokens - reply.outputTokens
          : 0;
    await this.c.query(
      "UPDATE planning_jobs SET remaining_tokens=greatest(0,remaining_tokens+$2) WHERE id=$1",
      [row.job_id, refund],
    );
  }
  async finish(work: PlanningWork, document?: AgentPlan, error?: string) {
    const row = (
      await this.c.query(
        "SELECT * FROM planning_jobs WHERE id=$1 AND state IN ('queued','running') FOR UPDATE",
        [work.id],
      )
    ).rows[0];
    if (!row) return;
    const authorized = await this.ready(work);
    const result =
      authorized && document
        ? {
            ...document,
            steps: document.steps.map((step) => ({
              ...step,
              ...(!step.modelSelectionId &&
              row.input.modelSelectionId &&
              step.model === row.input.model
                ? { modelSelectionId: row.input.modelSelectionId }
                : {}),
            })),
          }
        : undefined;
    if (!row.charged)
      await this.c.query(
        "UPDATE planning_days SET held=held-1 WHERE user_id=$1 AND day=$2",
        [row.user_id, row.day],
      );
    await this.c.query(
      "UPDATE planning_jobs SET state=$2,error_code=$3,finished_at=$4 WHERE id=$1",
      [
        work.id,
        result ? "succeeded" : row.cancel_requested ? "cancelled" : "failed",
        result ? null : (error ?? "PLANNING_STOPPED"),
        this.now(),
      ],
    );
    if (result) {
      const ids = [
        ...new Set(result.steps.flatMap((step) => step.referenceIds)),
      ].sort();
      if (
        (
          await this.c.query(
            "SELECT id FROM image_assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND state='ready' ORDER BY id FOR UPDATE",
            [row.workspace_id, ids],
          )
        ).rowCount !== ids.length
      )
        throw new AppError("REFERENCE_UNAVAILABLE", 409);
      await this.c.query(
        "INSERT INTO agent_references(workspace_id,job_id,asset_id) SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT DO NOTHING",
        [row.workspace_id, row.id, ids],
      );
      await this.c.query(
        "INSERT INTO agent_plans(workspace_id,job_id,version,request_key,input_hash,document) VALUES($1,$2,1,$2,$3,$4)",
        [row.workspace_id, row.id, hash(result), result],
      );
    }
  }
  private async project(p: Principal, id: string) {
    await this.auth(this.c, p, false, false);
    if (
      !(
        await this.c.query(
          "SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
          [p.workspaceId, id],
        )
      ).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
  }
  private async planRows(jobIds: string[]) {
    if (!jobIds.length) return [];
    return (
      await this.c.query(
        `SELECT p.*, ARRAY(SELECT t.id FROM image_tasks t WHERE t.agent_plan_id=p.id ORDER BY t.step_index) AS task_ids
       FROM unnest($1::uuid[]) AS jobs(id)
       CROSS JOIN LATERAL (SELECT * FROM agent_plans WHERE job_id=jobs.id ORDER BY version DESC LIMIT 50) p
       ORDER BY p.job_id,p.version`,
        [jobIds],
      )
    ).rows;
  }
  private async jobDto(row: any, loadedPlans?: any[]): Promise<PlanningJob> {
    const plans = loadedPlans ?? (await this.planRows([row.id]));
    return {
      textSources: row.input?.textSources ?? [],
      id: row.id,
      projectId: row.project_id,
      requestKey: row.request_key,
      prompt: row.input.prompt,
      ...(row.input.style ? { style: row.input.style } : {}),
      state: row.state,
      charged: row.charged,
      errorCode: row.error_code,
      createdAt: row.created_at.toISOString(),
      plans: plans.map((r) => ({
        id: r.id,
        jobId: r.job_id,
        version: r.version,
        document: agentPlan.parse(r.document),
        confirmed: !!r.confirmed_at,
        taskIds: r.task_ids,
      })),
    };
  }
  async existing(p: Principal, input: PlanningRequest) {
    await this.project(p, input.projectId);
    const row = (
      await this.c.query(
        "SELECT * FROM planning_jobs WHERE workspace_id=$1 AND project_id=$2 AND request_key=$3",
        [p.workspaceId, input.projectId, input.requestKey],
      )
    ).rows[0];
    if (row) {
      if (row.archived) throw new AppError("NOT_FOUND", 404);
      if (row.input_hash !== hash(input))
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return this.jobDto(row);
    }
    if (
      input.previousPlanId &&
      !(
        await this.c.query(
          "SELECT 1 FROM agent_plans p JOIN planning_jobs j ON j.id=p.job_id WHERE p.workspace_id=$1 AND p.id=$2 AND j.project_id=$3 AND NOT j.archived",
          [p.workspaceId, input.previousPlanId, input.projectId],
        )
      ).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
    return null;
  }
  async budget(p: Principal) {
    const day = shanghaiDay(this.now());
    const settings = (
      await this.c.query("SELECT queue_limit FROM planning_settings WHERE id=1")
    ).rows[0];
    const policy = (
      await this.c.query("SELECT * FROM planning_policies WHERE user_id=$1", [
        p.id,
      ])
    ).rows[0];
    const daily = (
      await this.c.query(
        "SELECT * FROM planning_days WHERE user_id=$1 AND day=$2",
        [p.id, day],
      )
    ).rows[0];
    const queue = (
      await this.c.query(
        "SELECT count(*) total,count(*) FILTER(WHERE user_id=$1) own FROM planning_jobs WHERE state='queued'",
        [p.id],
      )
    ).rows[0];
    const recent = (
      await this.c.query(
        "SELECT count(*) n FROM planning_jobs WHERE user_id=$1 AND created_at>$2::timestamptz-interval '1 minute'",
        [p.id, this.now()],
      )
    ).rows[0];
    return {
      day,
      limit: policy?.daily_limit ?? 50,
      used: daily?.used ?? 0,
      held: daily?.held ?? 0,
      queued: Number(queue.total),
      ownQueued: Number(queue.own),
      queueLimit: settings.queue_limit,
      ownQueueLimit: policy?.queue_limit ?? 10,
      recent: Number(recent.n),
    };
  }
  async create(
    p: Principal,
    input: PlanningRequest,
    provider: string,
    messages: PlanningMessages[],
    tokens: number,
    day: string,
    referenceIds: string[],
    textSources: import("@tuyile/contracts").TextSource[] = [],
  ) {
    const ids = [...new Set(referenceIds)].sort();
    if (
      (
        await this.c.query(
          "SELECT id FROM image_assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND state='ready' ORDER BY id FOR UPDATE",
          [p.workspaceId, ids],
        )
      ).rowCount !== ids.length
    )
      throw new AppError("REFERENCE_UNAVAILABLE", 409);
    const row = (
      await this.c.query(
        "INSERT INTO planning_jobs(workspace_id,project_id,user_id,execution_version,request_key,input_hash,input,messages,provider_id,skill_id,day,remaining_tokens,deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
        [
          p.workspaceId,
          input.projectId,
          p.id,
          p.executionVersion,
          input.requestKey,
          hash(input),
          { ...input, textSources },
          JSON.stringify(messages),
          provider,
          input.skillId ?? null,
          day,
          tokens,
          new Date(this.now().getTime() + 30 * 60000),
        ],
      )
    ).rows[0];
    await this.c.query(
      "INSERT INTO planning_days(user_id,day,held) VALUES($1,$2,1) ON CONFLICT(user_id,day) DO UPDATE SET held=planning_days.held+1",
      [p.id, day],
    );
    await this.c.query(
      "INSERT INTO agent_references(workspace_id,job_id,asset_id) SELECT $1,$2,unnest($3::uuid[])",
      [p.workspaceId, row.id, ids],
    );
    return this.jobDto(row);
  }
  async jobs(p: Principal, project: string, offset = 0) {
    await this.project(p, project);
    const rows = (
      await this.c.query(
        "SELECT * FROM planning_jobs WHERE workspace_id=$1 AND project_id=$2 AND NOT archived ORDER BY created_at DESC,id LIMIT 50 OFFSET $3",
        [p.workspaceId, project, offset],
      )
    ).rows;
    const plans = await this.planRows(rows.map((r) => r.id));
    const byJob = new Map<string, typeof plans>();
    for (const plan of plans) {
      const group = byJob.get(plan.job_id) ?? [];
      group.push(plan);
      byJob.set(plan.job_id, group);
    }
    return Promise.all(rows.map((r) => this.jobDto(r, byJob.get(r.id) ?? [])));
  }
  async usage(p: Principal) {
    await this.auth(this.c, p, false, false);
    const b = await this.budget(p);
    const policy = (
      await this.c.query(
        "SELECT concurrency FROM planning_policies WHERE user_id=$1",
        [p.id],
      )
    ).rows[0];
    return {
      dailyLimit: b.limit,
      queueLimit: b.ownQueueLimit,
      concurrency: policy?.concurrency ?? 1,
      used: b.used,
      held: b.held,
      available: Math.max(0, b.limit - b.used - b.held),
    };
  }
  async revision(
    p: Principal,
    job: string,
    input: PlanRevisionInput,
  ): Promise<AgentPlanVersion> {
    await this.auth(this.c, p);
    const owner = (
      await this.c.query(
        "SELECT * FROM planning_jobs WHERE workspace_id=$1 AND id=$2 AND NOT archived FOR UPDATE",
        [p.workspaceId, job],
      )
    ).rows[0];
    if (!owner) throw new AppError("NOT_FOUND", 404);
    if (owner.state !== "succeeded") throw new AppError("PLAN_NOT_READY", 409);
    const old = (
      await this.c.query(
        "SELECT * FROM agent_plans WHERE job_id=$1 AND request_key=$2",
        [job, input.requestKey],
      )
    ).rows[0];
    if (old && old.input_hash !== hash(input.document))
      throw new AppError("IDEMPOTENCY_CONFLICT", 409);
    const ids = [
      ...new Set(input.document.steps.flatMap((s) => s.referenceIds)),
    ].sort();
    if (
      (
        await this.c.query(
          "SELECT id FROM image_assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND state='ready' ORDER BY id FOR UPDATE",
          [p.workspaceId, ids],
        )
      ).rowCount !== ids.length
    )
      throw new AppError("REFERENCE_UNAVAILABLE", 409);
    const row =
      old ??
      (
        await this.c.query(
          "INSERT INTO agent_plans(workspace_id,job_id,version,request_key,input_hash,document) SELECT $1,$2,coalesce(max(version),0)+1,$3,$4,$5 FROM agent_plans WHERE job_id=$2 RETURNING *",
          [
            p.workspaceId,
            job,
            input.requestKey,
            hash(input.document),
            input.document,
          ],
        )
      ).rows[0];
    await this.c.query(
      "INSERT INTO agent_references(workspace_id,job_id,asset_id) SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT DO NOTHING",
      [p.workspaceId, job, ids],
    );
    return {
      id: row.id,
      jobId: job,
      version: row.version,
      document: agentPlan.parse(row.document),
      confirmed: !!row.confirmed_at,
      taskIds: [],
    };
  }
}
