import sharp from "sharp";
import { validateSvg } from "./svg-validation.js";
// No application config, credentials or filesystem paths are accepted by this process.
sharp.cache(false);
sharp.concurrency(1);
try {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error("limit");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  validateSvg(bytes);
  const output = await sharp(bytes, {
    limitInputPixels: 8294400,
    failOn: "warning",
  })
    .timeout({ seconds: 2 })
    .png()
    .toBuffer();
  if (output.length > 20 * 1024 * 1024) throw new Error("limit");
  process.stdout.write(output);
} catch {
  process.exitCode = 1;
}
