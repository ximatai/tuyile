import { expect, it } from "vitest";
import { recommendedModelCapabilities } from "../../apps/web/src/model-recommendations";
import { imageDeclarationWithinKnownLimits } from "@tuyile/contracts";
it("recommends Terra vision and product budgets instead of provider maxima", () => {
  expect(recommendedModelCapabilities("gpt-6.1-terra", "conversation")).toEqual(
    {
      conversation: {
        supportsImages: true,
        responseMode: "json_object",
        maxOutputTokens: 4096,
        maxInputCharacters: 32000,
      },
    },
  );
  expect(
    recommendedModelCapabilities("unverified", "conversation").conversation
      ?.supportsImages,
  ).toBe(false);
});
it("uses documented image defaults while keeping unknown models conservative", () => {
  const known = recommendedModelCapabilities(
    "gpt-image-2.5-sunburst",
    "image",
  ).image!;
  expect(known.formats).toEqual(["png", "jpeg", "webp"]);
  expect(imageDeclarationWithinKnownLimits(known)).toBe(true);
  const unknown = recommendedModelCapabilities("unverified", "image").image!;
  expect(unknown).toMatchObject({
    editing: false,
    maxReferences: 0,
    sizes: ["1024x1024"],
    formats: ["png"],
  });
  known.formats.pop();
  expect(
    recommendedModelCapabilities("gpt-image-2.5-sunburst", "image").image
      ?.formats,
  ).toHaveLength(3);
});
