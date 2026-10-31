import { Skeleton, Spin } from "@tuyile/ui";

/** Match the destination layout while code and project data arrive. */
export function LoadingState({
  variant = "page",
}: {
  variant?: "app" | "page" | "workspace" | "canvas";
}) {
  const label = variant === "canvas" ? "正在加载画布" : "正在加载页面";
  if (variant === "workspace")
    return (
      <div
        className="loading-workspace creation-layout"
        role="status"
        aria-label={label}
      >
        <CanvasPlaceholder />
        <div className="loading-editor" aria-hidden="true">
          <Skeleton title={{ width: "42%" }} paragraph={false} />
          <div className="loading-prompt" />
          <Skeleton
            title={false}
            paragraph={{ rows: 2, width: ["32%", "100%"] }}
          />
          <div className="loading-controls">
            <Skeleton title={false} paragraph={{ rows: 4, width: "100%" }} />
            <Skeleton title={false} paragraph={{ rows: 4, width: "100%" }} />
          </div>
          <div className="loading-submit" />
        </div>
      </div>
    );
  if (variant === "canvas")
    return (
      <div
        className="loading-canvas-container"
        role="status"
        aria-label={label}
      >
        <CanvasPlaceholder />
      </div>
    );
  if (variant === "app")
    return (
      <main className="loading-app" role="status" aria-label="正在打开工作区">
        <Spin delay={150} />
        <span>正在打开工作区</span>
      </main>
    );
  return (
    <div className="loading-page" role="status" aria-label={label}>
      <div aria-hidden="true">
        <Skeleton title={{ width: 120 }} paragraph={false} />
        <div className="loading-page-content">
          <Skeleton
            title={false}
            paragraph={{ rows: 3, width: ["70%", "100%", "45%"] }}
          />
        </div>
      </div>
    </div>
  );
}
function CanvasPlaceholder() {
  return (
    <div className="loading-canvas" aria-hidden="true">
      <Spin delay={150} />
    </div>
  );
}
