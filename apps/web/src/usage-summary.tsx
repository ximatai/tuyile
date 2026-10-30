import type { ImageUsage } from "@tuyile/contracts";
export function UsageSummary({ usage }: { usage: ImageUsage }) {
  return (
    <div className="usage-summary">
      <h2>今日图片额度</h2>
      <div className="usage-numbers">
        <span>
          已用 <strong>{usage.used}</strong>
        </span>
        <span>
          预留 <strong>{usage.held}</strong>
        </span>
        <span>
          可用 <strong>{usage.available}</strong>
        </span>
      </div>
      {usage.earlierHeld > 0 && (
        <p className="hint">历史日期另有 {usage.earlierHeld} 张待结算预留。</p>
      )}
      <p className="hint">
        上游尝试 {usage.attempts} / {usage.policy.attemptsLimit} · 每日上海时间
        00:00 切换
      </p>
      <p className="hint">
        存储{" "}
        {((usage.storageUsed + usage.storageReserved) / 1048576).toFixed(1)} /{" "}
        {(usage.policy.storageLimit / 1048576).toFixed(0)} MiB（包含预留）
      </p>
      <p className="hint">次数额度不代表账单上限。</p>
    </div>
  );
}
