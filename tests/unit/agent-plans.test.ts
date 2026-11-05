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

it("keeps dependency identity across subset selection and binds existing assets without rerunning ancestors", async () => {
  const { identifyPlan, selectPlan } = await import("@tuyile/contracts");
  const plan = identifyPlan(
    agentPlan.parse({
      message: "方向",
      steps: [
        { ...step(), count: 1 },
        {
          ...step(),
          count: 1,
          usePrevious: true,
          tool: { id: "image.edit", version: 1 },
        },
        { ...step(), count: 1 },
      ],
    }),
    "stable",
  );
  const [a, b, c] = plan.steps;
  expect(b.dependsOn).toBe(a.id);
  expect(() =>
    selectPlan(plan, { requestKey: "unused", stepIds: [b.id!], bindings: [] }),
  ).toThrow("MISSING_DEPENDENCY");
  const result = selectPlan(plan, {
    requestKey: "unused",
    stepIds: [c.id!, b.id!],
    bindings: [
      { stepId: a.id!, assetId: "00000000-0000-4000-8000-000000000001" },
    ],
  });
  expect(result.steps.map((s) => s.id)).toEqual([b.id, c.id]);
  expect(result.steps[0].referenceIds).toEqual([
    "00000000-0000-4000-8000-000000000001",
  ]);
  expect(result.steps[0].dependsOn).toBeUndefined();
  expect(
    selectPlan(plan, {
      requestKey: "unused",
      stepIds: [a.id!, b.id!],
      bindings: [],
    }).steps[1].dependsOn,
  ).toBe(a.id);
});
