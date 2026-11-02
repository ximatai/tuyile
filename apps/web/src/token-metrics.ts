const exact = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const units = [
  { value: 1, label: "" },
  { value: 1e4, label: "万" },
  { value: 1e8, label: "亿" },
  { value: 1e12, label: "万亿" },
];
export function formatTokens(value: number): string {
  let index = 0;
  while (index < units.length - 1 && value >= units[index + 1].value) index++;
  // Promote a rounded boundary rather than displaying 10,000 万/亿.
  if (
    index > 0 &&
    index < units.length - 1 &&
    Math.round((value / units[index].value) * 100) / 100 >= 10000
  )
    index++;
  return index === 0
    ? exact.format(value)
    : `${compact.format(value / units[index].value)} ${units[index].label}`;
}
export const exactTokens = (value: number): string => exact.format(value);
