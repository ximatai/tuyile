import { formatStorage } from "./usage-metrics";
import type { ImageUsage } from "@tuyile/contracts";
export function UsageSummary({ usage }: { usage: ImageUsage }) {
  return (
    <div className="usage-summary">
      <h2>今日图片额度</h2>
      <div className="usage-numbers">
        <span>
          已生成 <strong>{usage.used}</strong>
        </span>
        {usage.held > 0 && (
          <span>
            待结算 <strong>{usage.held}</strong>
          </span>
        )}
        <span>
          可用{" "}
          <strong>
            {usage.available === null ? "不限额" : usage.available}
          </strong>
        </span>
      </div>
      {usage.earlierHeld > 0 && (
        <p className="hint">历史任务另有 {usage.earlierHeld} 张待结算。</p>
      )}
      <p className="hint">
        模型调用 {usage.attempts} / {usage.policy.attemptsLimit} · 每日上海时间
        00:00 切换
      </p>
      <p className="hint">
        存储 {formatStorage(usage.storageUsed + usage.storageReserved)} /{" "}
        {formatStorage(usage.policy.storageLimit)}
        {usage.storageReserved > 0 ? "（含待结算）" : ""}
      </p>
      <p className="hint">次数额度不代表账单上限。</p>
    </div>
  );
}
