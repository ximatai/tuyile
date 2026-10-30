import { expect, it } from "vitest";
import {
  effectiveImageCapability,
  imageCapabilityDefaults,
  imageModelKnowledge,
  imageSizeWithinKnownLimits,
  poolPublication,
} from "@tuyile/contracts";
import { checkImageCapability } from "@tuyile/core";
it("records documented limits and keeps the administrator subset", () => {
  const model = "gpt-image-2.5-sunburst";
  expect(imageModelKnowledge(model)).toMatchObject({
    evidence: "documentation",
    checkedAt: "2026-10-30",
    formats: ["png", "jpeg", "webp"],
  });
  const cap = effectiveImageCapability({
    ...imageCapabilityDefaults(model),
    formats: ["png"],
  });
  expect(cap.formats).toEqual(["png"]);
  expect(cap.maxEdge).toBe(3840);
  expect(imageSizeWithinKnownLimits(model, 512, 512)).toBe(false);
  expect(imageSizeWithinKnownLimits(model, 3840, 1024)).toBe(false);
  expect(imageSizeWithinKnownLimits(model, 3840, 2160)).toBe(true);
  expect(imageModelKnowledge("unverified-model")).toBeUndefined();
});
it("rejects oversized administrator declarations for a documented model", () => {
  expect(
    poolPublication.safeParse({
      revision: 0,
      entries: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          serviceId: "00000000-0000-4000-8000-000000000002",
          modelId: "gpt-image-2.5-flare",
          kind: "image",
          enabled: true,
          isDefault: true,
          image: imageCapabilityDefaults("gpt-image-2.5-flare"),
        },
      ],
    }).success,
  ).toBe(false);
});
it("checks both documented limits and declared formats at submission", () => {
  const model = "gpt-image-2.5-flare";
  const cap = { ...imageCapabilityDefaults(model), formats: ["png"] as const };
  const input = {
    model,
    width: 512,
    height: 512,
    format: "png",
    quality: "medium",
    referenceIds: [],
    count: 1,
  };
  expect(() =>
    checkImageCapability(input as any, [{ ...cap, formats: [...cap.formats] }]),
  ).toThrow();
  expect(() =>
    checkImageCapability(
      { ...input, width: 1024, height: 1024, format: "jpeg" } as any,
      [{ ...cap, formats: [...cap.formats] }],
    ),
  ).toThrow();
});
