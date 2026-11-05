import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
  AgentPlanVersion,
  ImageTask,
  PlanSelectionInput,
} from "@tuyile/contracts";
import { Button, Checkbox, Collapse, Select, Notice } from "@tuyile/ui";
import { client, ApiError } from "./api";
import { useSessionState } from "./session-state";

export function PlanSelection({
  plan,
  sourcePlans,
  tasks,
  disabled,
  onRefresh,
  onWaitingChange,
}: {
  plan: AgentPlanVersion;
  sourcePlans: AgentPlanVersion[];
  tasks: ImageTask[];
  disabled: boolean;
  onRefresh: (id?: string) => Promise<void>;
  onWaitingChange: (v: boolean) => void;
}) {
  const state = useSessionState();
  const [ids, setIds] = useState<string[]>([]);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PlanSelectionInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const unresolved = useRef(false);
  unresolved.current = busy || !!pending;
  useEffect(
    () =>
      state.registerNavigationGuard({
        isDirty: () => unresolved.current,
        canLeave: async () => !unresolved.current,
      }),
    [state],
  );
  useEffect(() => {
    onWaitingChange(busy || !!pending);
    return () => onWaitingChange(false);
  }, [busy, pending, onWaitingChange]);
  const sources = [
    ...new Set(
      plan.document.steps
        .filter(
          (s) =>
            ids.includes(s.id!) && s.dependsOn && !ids.includes(s.dependsOn),
        )
        .map((s) => s.dependsOn!),
    ),
  ];
  const missingTasks = [
    ...new Set(
      sourcePlans.flatMap((version) =>
        version.document.steps.flatMap((step, index) =>
          sources.includes(step.id!) &&
          version.taskIds[index] &&
          !tasks.some((t) => t.id === version.taskIds[index])
            ? [version.taskIds[index]]
            : [],
        ),
      ),
    ),
  ].sort();
  const priorTasks = useQuery({
    queryKey: state.key("agent-source-tasks", plan.id, missingTasks.join(",")),
    enabled: missingTasks.length > 0,
    queryFn: async ({ signal }) => {
      const result: ImageTask[] = [];
      // Versions and steps are bounded; keep concurrent authorization queries bounded too.
      for (let i = 0; i < missingTasks.length; i += 4)
        result.push(
          ...(await Promise.all(
            missingTasks
              .slice(i, i + 4)
              .map((id) =>
                client(state.session.csrfToken)<ImageTask>(
                  `/images/tasks/${id}`,
                  undefined,
                  signal,
                ),
              ),
          )),
        );
      return result;
    },
  });
  const availableTasks = [...tasks, ...(priorTasks.data ?? [])];
  const options = (id: string) => {
    const values = new Map<string, { value: string; label: string }>();
    for (const version of sourcePlans)
      version.document.steps.forEach((step, index) => {
        if (step.id !== id) return;
        const task = availableTasks.find(
          (t) => t.id === version.taskIds[index],
        );
        task?.outputs
          .filter((a) => !a.deleted)
          .forEach((a, i) =>
            values.set(a.id, {
              value: a.id,
              label: `${step.title} · 版本${version.version} · 结果${i + 1}`,
            }),
          );
      });
    return [...values.values()];
  };
  async function save() {
    if (active.current || disabled) return;
    active.current = true;
    setBusy(true);
    setError("");
    const input = pending ?? {
      requestKey: crypto.randomUUID(),
      stepIds: ids,
      bindings: sources.map((stepId) => ({
        stepId,
        assetId: bindings[stepId],
      })),
    };
    setPending(input);
    try {
      const saved = await client(state.session.csrfToken)<AgentPlanVersion>(
        `/agent/plans/${plan.id}/selection`,
        input,
      );
      await onRefresh(saved.id);
      setPending(null);
    } catch (e) {
      if (e instanceof ApiError && e.code !== "INTERNAL_ERROR")
        setPending(null);
      setError((e as Error).message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <Collapse
      ghost
      size="small"
      items={[
        {
          key: "selection",
          label: "选择步骤／复用作品继续",
          children: (
            <div>
              <p className="hint">
                选择本次要生成的步骤。未选择的前置步骤需绑定已有结果；保存后审阅新方案，再确认执行。
              </p>
              {plan.document.steps.map((s) => (
                <div key={s.id}>
                  <Checkbox
                    disabled={disabled || busy || !!pending}
                    checked={ids.includes(s.id!)}
                    onChange={(e) =>
                      setIds((old) =>
                        e.target.checked
                          ? [...old, s.id!]
                          : old.filter((id) => id !== s.id),
                      )
                    }
                  >
                    {s.title}
                  </Checkbox>
                </div>
              ))}
              {sources.map((id) => (
                <label className="field" key={id}>
                  <span>
                    复用 {plan.document.steps.find((s) => s.id === id)?.title}{" "}
                    的作品
                  </span>
                  <Select
                    aria-label={`复用 ${plan.document.steps.find((s) => s.id === id)?.title} 的作品`}
                    disabled={disabled || busy || !!pending}
                    value={bindings[id]}
                    options={options(id)}
                    onChange={(value) =>
                      setBindings((old) => ({ ...old, [id]: value }))
                    }
                  />
                  {bindings[id] && (
                    <img
                      width={64}
                      height={64}
                      style={{ objectFit: "contain" }}
                      alt="选定的前置作品"
                      src={`/api/images/assets/${bindings[id]}/preview`}
                    />
                  )}
                </label>
              ))}
              {priorTasks.error && (
                <Notice error>无法读取历史作品，请重新打开后重试。</Notice>
              )}
              {error && <Notice error>{error}</Notice>}
              <Button
                type="button"
                disabled={
                  disabled ||
                  busy ||
                  (!pending &&
                    (!ids.length || sources.some((id) => !bindings[id])))
                }
                onClick={() => void save()}
              >
                {pending ? "重试保存所选方案" : "保存所选方案"}
              </Button>
            </div>
          ),
        },
      ]}
    />
  );
}
