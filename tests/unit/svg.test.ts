import { it, expect } from "vitest";
import { validateSvg } from "../../packages/infrastructure/src/svg-validation.js";
import { rasterizeSvg } from "../../packages/infrastructure/src/svg-render.js";
import { PrivateImageFiles } from "@tuyile/infrastructure";
import { CompatibleImageProvider } from "@tuyile/infrastructure";
import { withSvgUsage, parseModelUsage } from "@tuyile/core";
import sharp from "sharp";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#0062b0"/></svg>';
const bytes = (s: string) => Buffer.from(s);
it("validates static SVG structure and rejects external resources, scripts, styles, entities and reference expansion", () => {
  expect(validateSvg(bytes(svg))).toEqual({ width: 256, height: 256 });
  for (const content of [
    "<script/>",
    '<image href="file:///etc/passwd"/>',
    "<foreignObject/>",
    "<style>path{fill:red}</style>",
    '<use href="https://example.com/a"/>',
    '<path style="fill:red"/>',
    '<g id="a"><use href="#a"/></g>',
    '<path fill="url(file:///a)"/>',
  ])
    expect(() =>
      validateSvg(
        bytes(
          svg.replace(
            '<rect width="256" height="256" fill="#0062b0"/>',
            content,
          ),
        ),
      ),
    ).toThrow();
  expect(() =>
    validateSvg(
      bytes('<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///etc/passwd">]>' + svg),
    ),
  ).toThrow();
  const chain = Array.from(
    { length: 20 },
    (_, i) =>
      `<g id="a${i}">${i ? `<use href="#a${i - 1}"/><use href="#a${i - 1}"/>` : '<path d="M0 0"/>'}</g>`,
  ).join("");
  expect(() =>
    validateSvg(
      bytes(
        svg.replace('<rect width="256" height="256" fill="#0062b0"/>', chain),
      ),
    ),
  ).toThrow();
  expect(() =>
    validateSvg(bytes(svg.replace('width="256"', 'width="999999"'))),
  ).toThrow();
});
it("renders in a separate bounded process and remains usable after rejected work", async () => {
  await expect(
    rasterizeSvg(bytes(svg.replace("<rect", "<script"))),
  ).rejects.toThrow();
  await expect(rasterizeSvg(bytes(svg), { wallMs: 1 })).rejects.toMatchObject({
    code: "SVG_PREVIEW_FAILED",
  });
  await expect(rasterizeSvg(bytes(svg), { rssKiB: 1 })).rejects.toMatchObject({
    code: "SVG_PREVIEW_FAILED",
  });
  const { png, width, height } = await rasterizeSvg(bytes(svg));
  expect([width, height]).toEqual([256, 256]);
  expect(await sharp(png).metadata()).toMatchObject({
    format: "png",
    width,
    height,
  });
  const results = await Promise.allSettled([
    rasterizeSvg(bytes(svg)),
    rasterizeSvg(bytes(svg)),
    rasterizeSvg(bytes(svg)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "SVG_RENDERER_BUSY" },
  });
}, 10000);
it("uses explicit author settings or omits the SVG object in service-default mode, retains independent unknown usage", async () => {
  for (const author of [
    { mode: "service-default" } as const,
    { mode: "explicit", model: "gpt-6.1-sol", reasoning: "low" } as const,
  ]) {
    const provider = new CompatibleImageProvider(
      false,
      0,
      async (_url, options) => {
        const input = JSON.parse(String(options?.body));
        expect(input.svg).toEqual(
          author.mode === "explicit"
            ? { model: "gpt-6.1-sol", reasoning: { effort: "low" } }
            : undefined,
        );
        return new Response(
          JSON.stringify({
            data: [{ b64_json: bytes(svg).toString("base64") }],
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              input_tokens_details: { text_tokens: 10, image_tokens: 0 },
            },
            svg_usage: {
              model: "gpt-6.1-sol",
              input_tokens: 30,
              output_tokens: 40,
              reasoning_tokens: 5,
              total_tokens: 70,
            },
          }),
        );
      },
    );
    let usage: any;
    await provider.generate(
      {
        mode: "openai",
        baseUrl: "https://example.invalid/v1",
        apiKey: "synthetic",
        svgAuthor: author,
      },
      {
        projectId: "",
        requestKey: "",
        prompt: "test",
        model: "test",
        width: 256,
        height: 256,
        format: "svg",
        quality: "medium",
        count: 1,
        referenceIds: [],
      },
      [],
      new AbortController().signal,
      async (u) => {
        usage = u;
      },
    );
    expect(usage.inputTokens).toBe(10);
    expect(usage.svg.inputTokens).toBe(30);
    expect(usage.svg.reasoningTokens).toBe(5);
    expect(usage.svg.referenceUsd).toBeCloseTo(0.00046);
  }
  expect(
    withSvgUsage(parseModelUsage({}, "image"), undefined, {
      mode: "service-default",
    }).svg,
  ).toMatchObject({
    model: null,
    inputTokens: null,
    priceSnapshot: null,
    referenceUsd: null,
  });
});

it("keeps SVG and other unaccepted formats out of raster uploads while validating accepted image bytes", async () => {
  const files = new PrivateImageFiles(".codex-temp/svg-validation-unit", 0);
  await expect(files.inspect(bytes(svg))).rejects.toMatchObject({
    code: "INVALID_IMAGE",
  });
  await expect(
    files.inspect(
      bytes(svg.replace("<rect", '<image href="file:///etc/passwd"')),
    ),
  ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  const png = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
  })
    .png()
    .toBuffer();
  expect((await files.inspect(png)).mime).toBe("image/png");
  for (const format of ["jpeg", "webp"] as const) {
    const raster = await sharp(png).toFormat(format).toBuffer();
    expect((await files.inspect(raster)).mime).toBe(`image/${format}`);
  }
  await expect(
    files.inspect(Buffer.concat([png.subarray(0, 8), bytes(svg)])),
  ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
});
