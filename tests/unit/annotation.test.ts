import { it, expect } from "vitest";
import sharp from "sharp";
import { imageAnnotation, imageCapabilityDefaults } from "@tuyile/contracts";
import { checkImageCapability } from "@tuyile/core";
import { renderAnnotation } from "../../packages/infrastructure/src/image-annotation.js";
import { CompatibleImageProvider } from "@tuyile/infrastructure";
const annotation = imageAnnotation.parse({
  version: 1,
  strokes: [
    {
      kind: "ellipse",
      points: [
        [1000, 1000],
        [8000, 8000],
      ],
    },
  ],
});
it("bounds numeric geometry and total work without accepting XML", () => {
  expect(
    imageAnnotation.safeParse({
      version: 1,
      strokes: [
        {
          kind: "pen",
          points: [
            ["<svg>", 0],
            [0, 1],
          ],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    imageAnnotation.safeParse({
      version: 1,
      strokes: Array.from({ length: 10 }, () => ({
        kind: "pen",
        points: Array.from({ length: 256 }, () => [0, 0]),
      })),
    }).success,
  ).toBe(false);
  const input = {
    model: "test",
    width: 256,
    height: 256,
    quality: "medium",
    format: "png",
    count: 1,
    referenceIds: ["a"],
    annotation,
  };
  expect(() =>
    checkImageCapability(input as any, [imageCapabilityDefaults("test")]),
  ).toThrow();
  expect(() =>
    checkImageCapability(input as any, [
      { ...imageCapabilityDefaults("test"), markup: true },
    ]),
  ).not.toThrow();
  expect(() =>
    checkImageCapability({ ...input, count: 2 } as any, [
      { ...imageCapabilityDefaults("test"), markup: true },
    ]),
  ).toThrow();
});
it("renders a transparent overlay with oriented source dimensions and sends it as distinct markup", async () => {
  const original = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "white" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const overlay = await renderAnnotation(annotation, original);
  const meta = await sharp(overlay).metadata();
  expect([meta.width, meta.height]).toEqual([80, 120]);
  const alpha = (await sharp(overlay).stats()).channels[3];
  expect(alpha.min).toBe(0);
  expect(alpha.max).toBeGreaterThan(0);
  const provider = new CompatibleImageProvider(
    false,
    0,
    async (_url, options) => {
      const form = options!.body as FormData;
      expect(form.getAll("image[]")).toHaveLength(1);
      const markup = form.get("markup") as Blob;
      expect(markup.type).toBe("image/png");
      expect(
        (await sharp(Buffer.from(await markup.arrayBuffer())).metadata()).width,
      ).toBe(80);
      return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
    },
  );
  await provider.generate(
    {
      mode: "openai",
      baseUrl: "https://synthetic.invalid/v1",
      apiKey: "synthetic",
    },
    {
      projectId: "",
      requestKey: "",
      model: "test",
      prompt: "Synthetic",
      width: 256,
      height: 256,
      quality: "medium",
      format: "png",
      count: 1,
      referenceIds: ["a"],
      annotation,
    },
    [original],
    new AbortController().signal,
  );
});
