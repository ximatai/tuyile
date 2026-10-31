const formatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
export function formatStorage(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024) return "<1 KB";
  const unit = bytes >= 1024 ** 3 ? "GB" : bytes >= 1024 ** 2 ? "MB" : "KB";
  const divisor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return `${formatter.format(bytes / divisor)} ${unit}`;
}
export function quotaPercentage(used: number, limit: number): number {
  return limit <= 0 ? 0 : Math.min(100, Math.max(0, (used / limit) * 100));
}
