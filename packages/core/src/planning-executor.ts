import { agentPlan } from "@tuyile/contracts";
import {
  AgentService,
  type PlanningMessages,
  type PlanningWork,
} from "./agent.js";
import { PlanningCallError, type PlanningProvider } from "./extensions.js";
/** A running request has one deadline, one repair and one safe 429 retry. It never resumes after restart. */
export class PlanningExecutor {
  constructor(
    private readonly service: AgentService,
    private readonly provider: PlanningProvider,
  ) {}
  async execute(work: PlanningWork, signal: AbortSignal) {
    let repaired = false,
      retried = false,
      characters = 0;
    let messages: PlanningMessages[] = [...work.messages];
    try {
      const images = await this.service.references(work);
      while (true) {
        if (signal.aborted) throw new Error("PLANNING_INTERRUPTED");
        const size = messages.reduce((n, m) => n + m.content.length, 0);
        characters += size;
        const dispatch = await this.service.dispatch(work, 0, characters);
        let reply;
        try {
          reply = await this.provider.complete(
            dispatch.config,
            messages,
            dispatch.budget,
            signal,
            images,
          );
        } catch (error) {
          const call =
            error instanceof PlanningCallError
              ? error
              : new PlanningCallError("unknown", "PLANNING_RESULT_UNKNOWN");
          await this.service.attemptResult(
            work,
            dispatch.attemptId,
            call.kind,
            undefined,
            call.diagnosticCode ?? call.code,
          );
          if (
            call.kind === "rejected" &&
            call.status === 429 &&
            !retried &&
            !signal.aborted
          ) {
            retried = true;
            continue;
          }
          throw call;
        }
        await this.service.attemptResult(
          work,
          dispatch.attemptId,
          "received",
          reply,
        );
        let parsed;
        try {
          parsed = agentPlan.safeParse(JSON.parse(reply.text));
        } catch {
          parsed = undefined;
        }
        if (parsed?.success) {
          await this.service.finish(work, parsed.data);
          return;
        }
        if (repaired) throw new Error("PLANNING_FORMAT_INVALID");
        repaired = true;
        messages = [
          ...work.messages,
          { role: "assistant", content: reply.text.slice(0, 8000) },
          {
            role: "user",
            content:
              "上次结果不符合指定 JSON 结构。只修复格式和字段，保留需求，不增加图片上限或执行权限。",
          },
        ];
      }
    } catch (error) {
      const code =
        error instanceof PlanningCallError
          ? error.code
          : ((error as { code?: string }).code ?? (error as Error).message);
      const allowed = new Set([
        "PLANNING_BUDGET_EXCEEDED",
        "PLANNING_IMAGES_UNSUPPORTED",
        "REFERENCE_UNAVAILABLE",
        "PLANNING_REFERENCE_LIMIT",
        "PLANNING_FORMAT_INVALID",
        "PLANNING_RESPONSE_INVALID",
        "PLANNING_RESPONSE_LIMIT",
        "PLANNING_RESULT_UNKNOWN",
        "PLANNING_INTERRUPTED",
        "PLANNING_STOPPED",
        "PLANNING_PROVIDER_UNAVAILABLE",
        "SKILL_UNAVAILABLE",
        "TOOL_UNAVAILABLE",
        "PLANNING_UPSTREAM_FAILURE",
        "UPSTREAM_RATE_LIMIT",
      ]);
      await this.service.finish(
        work,
        undefined,
        allowed.has(code) ? code : "PLANNING_FAILED",
      );
    }
  }
}
