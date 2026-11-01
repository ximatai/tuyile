import { it, expect } from "vitest";
import { toolbarPlacement } from "../../apps/web/src/editor/toolbar-placement";
const input = {
  x: 100,
  y: 100,
  width: 240,
  height: 150,
  viewport: { x: 0, y: 0, zoom: 1 },
  canvasWidth: 700,
  canvasHeight: 600,
  toolbarWidth: 28,
};
it("keeps both card actions below and flips above when the bottom edge lacks space", () => {
  expect(toolbarPlacement(input).offset).toBe(8);
  const top = toolbarPlacement({ ...input, y: 0 });
  expect(150 + top.offset).toBe(158);
  const bottom = toolbarPlacement({ ...input, y: 440 });
  expect(590 + bottom.offset).toBe(404);
  expect(top.onScreen).toBe(true);
});
it("clamps partially visible nodes on both horizontal edges and hides offscreen nodes", () => {
  for (const x of [-220, 680]) {
    const result = toolbarPlacement({ ...input, x });
    const left = x + 240 - 28 + result.horizontalInset;
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 28).toBeLessThanOrEqual(692);
  }
  expect(toolbarPlacement({ ...input, y: -200 }).onScreen).toBe(false);
  expect(toolbarPlacement({ ...input, x: 800 }).onScreen).toBe(false);
});
it("aligns normal actions with the lower-right corner", () => {
  const result = toolbarPlacement(input);
  expect(result.horizontalInset).toBe(-8);
  expect(250 + result.offset).toBe(258);
});
