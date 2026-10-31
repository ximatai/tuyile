import type { ImageTask } from "@tuyile/contracts";
import { Button, Collapse, Descriptions, Notice } from "@tuyile/ui";
import { canReuseTask, taskProblem } from "./task-presentation";
export function TaskProblem({ task }: { task: ImageTask }) {
  const problem = taskProblem(task);
  return problem ? (
    <Notice error={!task.pendingReview && task.state !== "cancelled"}>
      {problem}
    </Notice>
  ) : null;
}
export function TaskDetails({
  task,
  onReuse,
  showProblem = true,
}: {
  task: ImageTask;
  onReuse?: (task: ImageTask) => void;
  showProblem?: boolean;
}) {
  return (
    <div className="task-shared-details">
      <Descriptions
        size="small"
        column={1}
        items={[
          {
            key: "time",
            label: "提交时间",
            children: new Date(task.createdAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            }),
          },
          { key: "model", label: "图片模型", children: task.model },
          ...(task.settings
            ? [
                {
                  key: "size",
                  label: "图片规格",
                  children: `${task.settings.width} × ${task.settings.height} · ${task.settings.format.toUpperCase()}`,
                },
              ]
            : []),
          {
            key: "count",
            label: "图片",
            children: `已保存 ${task.used} / ${task.count} 张${task.held ? ` · 预留 ${task.held} 张` : ""}`,
          },
        ]}
      />
      <div>
        <h3>创作需求</h3>
        <p className="task-detail-prompt">{task.prompt || "未填写"}</p>
      </div>
      {task.settings?.style && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: "style",
              label: `风格 · ${task.settings.style.name}`,
              children: (
                <>
                  <p>{task.settings.style.text}</p>
                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: "final",
                        label: "实际提交提示词",
                        children: <p>{task.finalPrompt}</p>,
                      },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      )}
      {showProblem && <TaskProblem task={task} />}
      {onReuse && canReuseTask(task) && (
        <Button type="button" onClick={() => onReuse(task)}>
          复用设置
        </Button>
      )}
    </div>
  );
}
