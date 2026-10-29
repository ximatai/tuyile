import { expect, it } from "vitest";
import { agentPlan } from "@tuyile/contracts";
const step = () => ({
  title: "合成步骤",
  prompt: "合成创作需求",
  model: "test-image",
  width: 1024,
  height: 1024,
  quality: "medium",
  format: "png",
  count: 4,
  referenceIds: [],
  tool: { id: "image.generate", version: 1 },
  usePrevious: false,
});
it("accepts clarification without image steps and enforces the complete plan image limit", () => {
  expect(
    agentPlan.parse({ message: "请补充主体要求", steps: [] }).steps,
  ).toEqual([]);
  expect(
    agentPlan.safeParse({
      message: "方案",
      steps: Array.from({ length: 4 }, step),
    }).success,
  ).toBe(true);
  expect(
    agentPlan.safeParse({
      message: "方案",
      steps: Array.from({ length: 5 }, step),
    }).success,
  ).toBe(false);
});
it("rejects missing previous outputs and executable fields in a declarative plan", () => {
  expect(
    agentPlan.safeParse({
      message: "方案",
      steps: [{ ...step(), usePrevious: true }],
    }).success,
  ).toBe(false);
  expect(
    agentPlan.safeParse({
      message: "方案",
      steps: [{ ...step(), command: "arbitrary code" }],
    }).success,
  ).toBe(false);
  expect(
    agentPlan.safeParse({ message: "方案", steps: [step()], executeNow: true })
      .success,
  ).toBe(false);
});
