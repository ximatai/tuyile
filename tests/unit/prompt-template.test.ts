import { expect, it } from "vitest";
import { promptTemplateInput } from "@tuyile/contracts";
const valid = {
  id: "brand-banner",
  title: " 标题 ",
  category: " 分类 ",
  prompt: " 正文 ",
  published: false,
  revision: 0,
};
it("normalizes template content and rejects invalid limits or identities before persistence", () => {
  expect(promptTemplateInput.parse(valid)).toMatchObject({
    title: "标题",
    category: "分类",
    prompt: "正文",
  });
  for (const extra of [
    { id: "../bad" },
    { title: " " },
    { category: " " },
    { prompt: " " },
    { prompt: "a\0b" },
    { prompt: "a".repeat(12001) },
    { title: "a".repeat(101) },
    { category: "a".repeat(61) },
    { revision: -1 },
    { published: "true" },
    { unexpected: true },
  ]) {
    expect(promptTemplateInput.safeParse({ ...valid, ...extra }).success).toBe(
      false,
    );
  }
  expect(
    promptTemplateInput.safeParse({ ...valid, prompt: "a".repeat(12000) })
      .success,
  ).toBe(true);
});

it("normalizes category filters and rejects empty or oversized values", async () => {
  const { promptCategoryFilter } = await import("@tuyile/contracts");
  expect(promptCategoryFilter.parse([])).toEqual([]);
  expect(promptCategoryFilter.parse([" 商品 ", "摄影", "商品"])).toEqual([
    "商品",
    "摄影",
  ]);
  expect(promptCategoryFilter.safeParse([""]).success).toBe(false);
  expect(promptCategoryFilter.safeParse(["x".repeat(61)]).success).toBe(false);
});
