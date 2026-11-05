import sharp from "sharp";
import { imageAnnotation, type ImageAnnotation } from "@tuyile/contracts";
import { ImageCallError } from "@tuyile/core";
/** Only bounded numeric geometry becomes markup. No caller-supplied XML is accepted. */
export async function renderAnnotation(
  value: ImageAnnotation,
  original: Uint8Array,
) {
  const annotation = imageAnnotation.parse(value);
  const meta = await sharp(original, {
    limitInputPixels: 32000000,
    failOn: "warning",
  }).metadata();
  const { width, height } = meta.autoOrient;
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 32000000
  )
    throw new ImageCallError("rejected", "INVALID_ANNOTATION");
  const elements = annotation.strokes
    .map((s) => {
      if (s.kind === "pen")
        return `<polyline points="${s.points.map((p) => p.join(",")).join(" ")}"/>`;
      const [[x, y], [endX, endY]] = s.points;
      return `<ellipse cx="${(x + endX) / 2}" cy="${(y + endY) / 2}" rx="${Math.abs(x - endX) / 2}" ry="${Math.abs(y - endY) / 2}"/>`;
    })
    .join("");
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 10000 10000" preserveAspectRatio="none"><g fill="none" stroke="#ff3030" stroke-width="45" stroke-linecap="round" stroke-linejoin="round">${elements}</g></svg>`,
    ),
    { limitInputPixels: 32000000 },
  )
    .png()
    .toBuffer();
}
