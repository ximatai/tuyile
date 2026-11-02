import { it, expect } from "vitest";
import { formatTokens, exactTokens } from "../../apps/web/src/token-metrics";
it("formats token counts in decimal Chinese units with exact small counts", () => {
  expect(formatTokens(0)).toBe("0");
  expect(formatTokens(9999)).toBe("9,999");
  expect(formatTokens(10000)).toBe("1 万");
  expect(formatTokens(12345)).toBe("1.23 万");
  expect(formatTokens(123456789)).toBe("1.23 亿");
  expect(formatTokens(1234567890123)).toBe("1.23 万亿");
});
it("promotes rounded unit boundaries and preserves the full count for inspection", () => {
  expect(formatTokens(99999999)).toBe("1 亿");
  expect(formatTokens(999999999999)).toBe("1 万亿");
  expect(exactTokens(1234567890123)).toBe("1,234,567,890,123");
  expect(formatTokens(Number.MAX_SAFE_INTEGER)).toBe("9,007.2 万亿");
});
