import { expect, it } from "vitest";
import { allowedConfiguredSize } from "../../apps/web/src/model-size-selector";
import { recommendedModelCapabilities } from "../../apps/web/src/model-recommendations";
it("validates custom dimensions against documented model constraints", () => {
  const cap = recommendedModelCapabilities(
    "gpt-image-2.5-sunburst",
    "image",
  ).image!;
  expect(allowedConfiguredSize(cap, 1920, 1088)).toBe(true);
  expect(allowedConfiguredSize(cap, 1920, 1080)).toBe(false);
  expect(allowedConfiguredSize(cap, 512, 512)).toBe(false);
  expect(allowedConfiguredSize(cap, 3840, 2160)).toBe(true);
  expect(allowedConfiguredSize(cap, 3840, 1024)).toBe(false);
  expect(allowedConfiguredSize({ ...cap, maxEdge: 2048 }, 3840, 2160)).toBe(
    false,
  );
});
