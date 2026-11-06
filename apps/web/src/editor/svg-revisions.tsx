import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SVG_REVISION_MAX_BYTES, type SvgRevision } from "@tuyile/contracts";
import {
  Button,
  ChoiceField,
  Modal,
  Notice,
  Upload,
  useConfirm,
} from "@tuyile/ui";
import { ApiError, client } from "../api";
import { useSessionState } from "../session-state";

export function SvgRevisions({
  sourceId,
  initialRevisionId,
  onClose,
  onPlace,
}: {
  sourceId: string;
  initialRevisionId?: string;
  onClose: () => void;
  onPlace: (
    asset: Pick<SvgRevision, "id" | "width" | "height">,
  ) => Promise<void>;
}) {
  const state = useSessionState();
  const api = client(state.session.csrfToken);
  const confirm = useConfirm();
  const endpoint = `/images/assets/${sourceId}/svg-revisions`;
  const queryKey = state.key("svg-revisions", sourceId);
  const [selectedId, setSelectedId] = useState(initialRevisionId);
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState("");
  const revisions = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api<{ revisions: SvgRevision[] }>(endpoint, undefined, signal),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (
        !/\.svg$/i.test(file.name) ||
        !file.size ||
        file.size > SVG_REVISION_MAX_BYTES
      )
        throw new Error("请选择非空的 SVG 文件，大小不超过 1 MiB。");
      return api<Pick<SvgRevision, "id" | "width" | "height">>(
        endpoint,
        new Blob([file], { type: "image/svg+xml" }),
        AbortSignal.timeout(15000),
      );
    },
    onSuccess: async (asset) => {
      setSelectedId(asset.id);
      await Promise.all([
        state.queries.invalidateQueries({ queryKey }),
        state.queries.invalidateQueries({ queryKey: state.key("gallery") }),
      ]);
    },
    onError: (cause) => {
      if (
        cause instanceof ApiError &&
        cause.code === "SVG_INVALID_OR_UNSUPPORTED"
      )
        setError(
          "文件未通过静态 SVG 校验。请在外部工具中导出纯 SVG，移除脚本、样式表、嵌入图片和外部链接后再试。",
        );
      else setError(cause.message);
    },
  });
  const exportPng = useMutation({
    mutationFn: async (target: { id: string; label: string }) => {
      if (
        !(await confirm(
          `将「${target.label}」导出为 PNG？导出会创建或复用栅格副本，占用存储并保留 SVG 原件。`,
        ))
      )
        return;
      const asset = await api<{ id: string }>(
        `/images/assets/${target.id}/raster-copy`,
        {},
        AbortSignal.timeout(15000),
      );
      location.assign(`/api/images/assets/${asset.id}/download`);
    },
    onError: (cause) => setError(cause.message),
  });
  const items = (revisions.data?.revisions ?? []).map((item, index, all) => ({
    ...item,
    label: `修订稿 ${all.length - index} · ${new Date(item.createdAt).toLocaleString("zh-CN")}`,
  }));
  const selected = selectedId
    ? items.find((item) => item.id === selectedId)
    : items[0];
  const place = useMutation({
    mutationFn: onPlace,
    onSuccess: (_, asset) => setPlaced(asset.id),
    onError: (cause) => setError(cause.message),
  });
  const busy = upload.isPending || exportPng.isPending || place.isPending;
  const selectionMissing = !!selectedId && !selected;
  return (
    <Modal
      open
      title="SVG 修订与交付"
      width={840}
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      mask={{ closable: !busy }}
      footer={
        <Button disabled={busy} onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="actions">
        <a className="button" href={`/api/images/assets/${sourceId}/download`}>
          下载原稿 SVG
        </a>
        <Upload
          accept=".svg,image/svg+xml"
          showUploadList={false}
          disabled={busy}
          beforeUpload={(file) => {
            setError("");
            upload.mutate(file);
            return false;
          }}
        >
          <Button disabled={busy} loading={upload.isPending}>
            导入 SVG 修订版
          </Button>
        </Upload>
      </div>
      <p className="muted">
        在外部工具精修后导入静态 SVG，最大 1
        MiB。每份修订单独保存，可以选择其中一稿交付。
      </p>
      {revisions.error && <Notice error>{revisions.error.message}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {selectionMissing && revisions.data && !busy && (
        <Notice error>所选修订稿已不可用，请重新选择或导入修订稿。</Notice>
      )}
      {items.length > 0 && (
        <ChoiceField
          label="比较修订稿"
          value={selected?.id}
          disabled={busy}
          onValueChange={(id) => {
            setSelectedId(id);
            setError("");
          }}
          options={items.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
        />
      )}
      <div className="image-edit-comparison">
        <figure>
          <img
            alt="SVG 原稿预览"
            src={`/api/images/assets/${sourceId}/preview`}
          />
          <figcaption>原稿</figcaption>
        </figure>
        <figure>
          {selected ? (
            <img
              alt="SVG 修订稿预览"
              src={`/api/images/assets/${selected.id}/preview`}
            />
          ) : (
            <p className="muted">
              {revisions.isPending
                ? "正在查找修订稿…"
                : "导入精修后的 SVG 后可并排比较。"}
            </p>
          )}
          <figcaption>{selected?.label ?? "修订稿"}</figcaption>
        </figure>
      </div>
      <div className="actions">
        {selected && (
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setError("");
                place.mutate(selected);
              }}
            >
              将这稿加入画布
            </Button>
            <a
              className="button"
              href={`/api/images/assets/${selected.id}/download`}
            >
              下载这稿 SVG
            </a>
          </>
        )}
        <Button
          disabled={busy || selectionMissing}
          onClick={() => {
            setError("");
            exportPng.mutate(selected ?? { id: sourceId, label: "原稿" });
          }}
        >
          {selected ? "导出这稿 PNG" : "导出原稿 PNG"}
        </Button>
      </div>
      {selected && placed === selected.id && (
        <p role="status">已将这稿加入画布</p>
      )}
    </Modal>
  );
}
