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
it("keeps note actions above the card normally and below when its palette touches the top", () => {
  expect(toolbarPlacement({ ...input, outside: true }).offset).toBe(8);
  const top = toolbarPlacement({ ...input, y: 0, outside: true });
  expect(0 - 28 - top.offset).toBe(158);
  expect(top.onScreen).toBe(true);
});
it("clamps partially visible nodes on both horizontal edges and hides offscreen nodes", () => {
  for (const x of [-220, 680]) {
    const result = toolbarPlacement({ ...input, x, outside: true });
    const left = x + 240 - 28 + result.horizontalInset;
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 28).toBeLessThanOrEqual(692);
  }
  expect(toolbarPlacement({ ...input, y: -200, outside: true }).onScreen).toBe(
    false,
  );
  expect(toolbarPlacement({ ...input, x: 800, outside: true }).onScreen).toBe(
    false,
  );
});
it("preserves the image action position inside the top right corner", () => {
  const result = toolbarPlacement(input);
  expect(result.horizontalInset).toBe(-8);
  expect(100 - 28 - result.offset).toBe(108);
});
