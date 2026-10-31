import { expect, it } from "vitest";
import {
  formatStorage,
  quotaPercentage,
} from "../../apps/web/src/usage-metrics";
it("formats storage in familiar units without rounding a small positive amount to zero", () => {
  expect(formatStorage(0)).toBe("0 MB");
  expect(formatStorage(1)).toBe("<1 KB");
  expect(formatStorage(1024)).toBe("1 KB");
  expect(formatStorage(7.6 * 1024 ** 2)).toBe("7.6 MB");
  expect(formatStorage(2 * 1024 ** 3)).toBe("2 GB");
});
it("keeps zero and reduced limits safe for progress display", () => {
  expect(quotaPercentage(0, 0)).toBe(0);
  expect(quotaPercentage(20, 0)).toBe(0);
  expect(quotaPercentage(20, 10)).toBe(100);
  expect(quotaPercentage(3, 10)).toBe(30);
});
