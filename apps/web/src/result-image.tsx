import { useEffect, useState } from "react";
import { Download, MoreHorizontal } from "lucide-react";
import { Button, Dropdown, Image, Tooltip } from "@tuyile/ui";
export function ResultImage({
  asset,
  onReference,
  onReuse,
  onRemove,
  busy = false,
}: {
  asset: { id: string; width: number; height: number; deleted?: boolean };
  onReference?: (id: string) => void;
  onReuse?: () => void;
  onRemove?: (id: string) => void;
  busy?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewRequested, setPreviewRequested] = useState(false);
  useEffect(() => {
    if (previewRequested && !menuOpen) {
      setPreviewRequested(false);
      setPreview(true);
    }
  }, [previewRequested, menuOpen]);
  return (
    <figure className="result-image">
      {asset.deleted ? (
        <div className="task-tile-placeholder">原图已删除</div>
      ) : (
        <>
          <Image
            src={`/api/images/assets/${asset.id}/preview`}
            alt={`已保存图片，${asset.width} × ${asset.height}`}
            loading="lazy"
            preview={{
              src: `/api/images/assets/${asset.id}/original`,
              motionName: "",
              open: preview,
              onOpenChange: setPreview,
            }}
          />
          <div className="result-image-actions">
            <Tooltip title="下载">
              <a
                className="task-tile-icon"
                aria-label="下载原图"
                href={`/api/images/assets/${asset.id}/download`}
              >
                <Download size={16} />
              </a>
            </Tooltip>
            <Dropdown
              trigger={["click"]}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              transitionName=""
              destroyOnHidden
              menu={{
                items: [
                  { key: "preview", label: "预览" },
                  ...(onReference
                    ? [
                        {
                          key: "reference",
                          label: "作为参考图",
                          disabled: busy,
                        },
                      ]
                    : []),
                  ...(onReuse
                    ? [{ key: "reuse", label: "复用设置", disabled: busy }]
                    : []),
                  ...(onRemove
                    ? [
                        {
                          key: "delete",
                          label: "删除原图",
                          danger: true,
                          disabled: busy,
                        },
                      ]
                    : []),
                ],
                onClick: ({ key }) => {
                  setMenuOpen(false);
                  if (key === "preview") setPreviewRequested(true);
                  if (key === "reference") onReference?.(asset.id);
                  if (key === "reuse") onReuse?.();
                  if (key === "delete") onRemove?.(asset.id);
                },
              }}
            >
              <Button type="button" aria-label="更多图片操作">
                <MoreHorizontal size={16} />
              </Button>
            </Dropdown>
          </div>
        </>
      )}
    </figure>
  );
}
