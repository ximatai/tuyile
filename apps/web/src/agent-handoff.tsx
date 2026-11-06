import { useRef, useState } from "react";
import type { CanvasNode } from "@tuyile/contracts";
import { Button, Field, Modal, Notice, Select } from "@tuyile/ui";
import { ProjectDraftProblem, useProjectDraft } from "./project-draft";

export interface AgentHandoffSource {
  key: string;
  assetId: string;
  label: string;
  preserveRequirements: string;
  textNodeIds: string[];
}

export function AgentHandoff({
  source,
  nodes,
  onCancel,
  onAccept,
}: {
  source: AgentHandoffSource;
  nodes: CanvasNode[];
  onCancel: () => void;
  onAccept: (
    preserveRequirements: string,
    textNodeIds: string[],
  ) => Promise<void>;
}) {
  const store = useProjectDraft();
  const available = nodes.filter((node) => node.text?.trim());
  const [preserve, setPreserve] = useState(source.preserveRequirements);
  const [textIds, setTextIds] = useState(
    source.textNodeIds.filter((id) => available.some((node) => node.id === id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accepting = useRef(false);
  const missingText = textIds.some(
    (id) => !available.some((node) => node.id === id),
  );
  async function accept() {
    if (accepting.current || missingText) return;
    accepting.current = true;
    setBusy(true);
    setError("");
    try {
      await onAccept(preserve, textIds);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      accepting.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="用这稿做 Agent 衍生"
      onCancel={busy ? undefined : onCancel}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button
            className="primary"
            loading={busy}
            disabled={missingText}
            onClick={() => void accept()}
          >
            带入 Agent 草稿
          </Button>
        </>
      }
    >
      <figure className="agent-handoff-source">
        <img
          src={`/api/images/assets/${source.assetId}/preview`}
          alt="衍生基准稿预览"
        />
        <figcaption>基准稿 · {source.label}</figcaption>
      </figure>
      <Field
        label="衍生保持要求"
        value={preserve}
        maxLength={2000}
        disabled={busy}
        onChange={(event) => setPreserve(event.target.value)}
      />
      <label className="field">
        <span>衍生引用文案</span>
        <Select
          aria-label="衍生引用文案"
          mode="multiple"
          maxCount={8}
          value={textIds}
          disabled={busy}
          options={available.map((node) => ({
            value: node.id,
            label: node.label || "未命名文案",
          }))}
          onChange={setTextIds}
        />
      </label>
      <p className="muted">
        带入会开启新的衍生上下文，替换 Agent
        输入与项目共享引用。图片和历史方案保留。你可以随后填写新增素材需求并生成计划。
      </p>
      {missingText && (
        <Notice error>所选文案已删除或清空，请移除后再带入。</Notice>
      )}
      <ProjectDraftProblem store={store} disabled={busy} />
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
