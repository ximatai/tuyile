import { Infinity as InfinityIcon, Info } from "lucide-react";
import { Button, Progress, Tooltip } from "@tuyile/ui";
import { formatStorage, quotaPercentage } from "./usage-metrics";
import type { ImageUsage } from "@tuyile/contracts";
export function UsageSummary({ usage }: { usage: ImageUsage }) {
  const unlimited = usage.available === null;
  const storage = usage.storageUsed + usage.storageReserved;
  return (
    <div className="usage-summary">
      <h2>今日图片额度</h2>
      <div className="quota-visual">
        <div aria-hidden="true">
          {unlimited ? (
            <div className="quota-unlimited">
              <InfinityIcon size={32} />
            </div>
          ) : (
            <Progress
              type="circle"
              size={88}
              percent={quotaPercentage(
                usage.used + usage.held,
                usage.policy.imageLimit,
              )}
              success={{
                percent: quotaPercentage(usage.used, usage.policy.imageLimit),
                strokeColor: "var(--brand-blue)",
              }}
              strokeColor="#aacde8"
              format={() => (
                <span className="quota-ring-value">
                  {usage.available}
                  <small>可用</small>
                </span>
              )}
            />
          )}
        </div>
        <div className="quota-image-counts">
          {unlimited ? (
            <strong className="quota-unlimited-label">图片不限额</strong>
          ) : (
            <span className="sr-only">
              可用 {usage.available} 张
            </span>
          )}
          <span>
            已生成 <strong>{usage.used}</strong> 张
          </span>
          {usage.held > 0 && (
            <span>
              待结算 <strong>{usage.held}</strong> 张
            </span>
          )}
        </div>
      </div>
      {usage.earlierHeld > 0 && (
        <p className="hint">历史任务另有 {usage.earlierHeld} 张待结算</p>
      )}
      <div className="quota-meter">
        <div>
          <span>模型调用</span>
          <span>
            {usage.attempts} / {usage.policy.attemptsLimit}
          </span>
        </div>
        <Progress
          aria-label="模型调用使用比例"
          percent={quotaPercentage(usage.attempts, usage.policy.attemptsLimit)}
          showInfo={false}
          size="small"
        />
      </div>
      <div className="quota-meter">
        <div>
          <span>存储{usage.storageReserved > 0 ? "（含待结算）" : ""}</span>
          <span>
            {formatStorage(storage)} /{" "}
            {formatStorage(usage.policy.storageLimit)}
          </span>
        </div>
        <Progress
          aria-label="存储空间使用比例"
          percent={quotaPercentage(storage, usage.policy.storageLimit)}
          showInfo={false}
          size="small"
        />
      </div>
      <div className="quota-reset hint">
        <span>每日 00:00 重置 · 上海时间</span>
        <Tooltip title="次数额度不代表账单上限。">
          <Button
            type="button"
            className="quota-billing-help"
            aria-label="额度与计费说明"
          >
            <Info size={14} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
