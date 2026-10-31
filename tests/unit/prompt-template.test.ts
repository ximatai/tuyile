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
