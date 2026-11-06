import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileUp } from "lucide-react";
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
  const revisionHeader = useRef<HTMLDivElement>(null);
  const focusFirstRevision = useRef(false);
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
  useEffect(() => {
    if (busy || !focusFirstRevision.current) return;
    focusFirstRevision.current = false;
    if (
      upload.isSuccess &&
      selected?.id &&
      document.activeElement === document.body
    )
      revisionHeader.current
        ?.querySelector<HTMLElement>('[role="combobox"]')
        ?.focus();
  }, [busy, selected?.id, upload.isSuccess]);
  const uploadAction = (
    <Upload
      accept=".svg,image/svg+xml"
      showUploadList={false}
      disabled={busy}
      beforeUpload={(file) => {
        setError("");
        focusFirstRevision.current = items.length === 0;
        upload.mutate(file);
        return false;
      }}
    >
      <Button
        className={items.length ? undefined : "primary"}
        disabled={busy}
        loading={upload.isPending}
      >
        {items.length ? "导入新稿" : "导入修订稿"}
      </Button>
    </Upload>
  );
  return (
    <Modal
      open
      centered
      title="SVG 修订与交付"
      width={920}
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      mask={{ closable: !busy }}
      footer={
        <Button disabled={busy} onClick={onClose}>
          关闭
        </Button>
      }
    >
      <p className="svg-revisions-intro">
        下载原稿到外部工具精修，再导回这里比较。每份稿件独立保存，选定后即可交付。
      </p>
      {revisions.error && <Notice error>{revisions.error.message}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {selectionMissing && revisions.data && !busy && (
        <Notice error>所选修订稿已不可用，请重新选择或导入修订稿。</Notice>
      )}
      <div className="svg-revisions-grid">
        <section className="svg-revision-card" aria-label="原稿">
          <div className="svg-revision-header">
            <h3>原稿</h3>
          </div>
          <div className="svg-revision-preview">
            <img
              alt="SVG 原稿预览"
              src={`/api/images/assets/${sourceId}/preview`}
            />
          </div>
          <div className="svg-revision-actions">
            <a href={`/api/images/assets/${sourceId}/download`}>
              <Download size={14} aria-hidden="true" />
              下载原稿 SVG
            </a>
            {!selected && (
              <Button
                disabled={busy || selectionMissing || revisions.isPending}
                onClick={() => {
                  setError("");
                  exportPng.mutate({ id: sourceId, label: "原稿" });
                }}
              >
                导出原稿 PNG
              </Button>
            )}
          </div>
        </section>
        <section className="svg-revision-card" aria-label="修订稿">
          <div className="svg-revision-header" ref={revisionHeader}>
            <h3>修订稿</h3>
            {items.length > 0 && (
              <>
                <ChoiceField
                  label="比较修订稿"
                  hideLabel
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
                {uploadAction}
              </>
            )}
          </div>
          {selected ? (
            <>
              <div className="svg-revision-preview">
                <img
                  alt="SVG 修订稿预览"
                  src={`/api/images/assets/${selected.id}/preview`}
                />
              </div>
              <div className="svg-revision-actions">
                <Button
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    place.mutate(selected);
                  }}
                >
                  将这稿加入画布
                </Button>
                <a href={`/api/images/assets/${selected.id}/download`}>
                  <Download size={14} aria-hidden="true" />
                  下载这稿 SVG
                </a>
                <Button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    exportPng.mutate(selected);
                  }}
                >
                  导出这稿 PNG
                </Button>
              </div>
            </>
          ) : (
            <div className="svg-revision-preview svg-revision-empty">
              {revisions.isPending ? (
                <p role="status">正在加载修订稿…</p>
              ) : items.length > 0 ? (
                <p>请选择一份修订稿进行比较。</p>
              ) : (
                <>
                  <FileUp size={28} aria-hidden="true" />
                  <strong>导回精修后的 SVG</strong>
                  <p>导入后可与原稿并排比较。</p>
                  {uploadAction}
                  <small>静态 SVG · 最大 1 MiB</small>
                </>
              )}
            </div>
          )}
          {selected && placed === selected.id && (
            <p className="svg-revision-status" role="status">
              已将这稿加入画布
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
