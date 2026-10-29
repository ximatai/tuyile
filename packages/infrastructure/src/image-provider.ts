import sharp from "sharp";
import {
  ImageCallError,
  type ImageProvider,
  type ImageExecutionConfig,
} from "@tuyile/core";
import type { ImageInput } from "@tuyile/contracts";
async function bounded(response: Response) {
  if (Number(response.headers.get("content-length")) > 32 * 1024 * 1024)
    throw new ImageCallError("unknown", "UPSTREAM_RESPONSE_LIMIT");
  const chunks: Uint8Array[] = [];
  let n = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new ImageCallError("unknown", "UNSUPPORTED_RESPONSE");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > 32 * 1024 * 1024)
        throw new ImageCallError("unknown", "UPSTREAM_RESPONSE_LIMIT");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export class CompatibleImageProvider implements ImageProvider {
  constructor(
    private fakeAllowed = false,
    private fakeDelay = 700,
    private fetcher: typeof fetch = fetch,
  ) {}
  async generate(
    config: ImageExecutionConfig,
    input: ImageInput,
    references: Uint8Array[],
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    if (config.mode === "fake") {
      if (!this.fakeAllowed)
        throw new ImageCallError("rejected", "FAKE_PROVIDER_DISABLED");
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          reject(new ImageCallError("unknown", "CANCELLED_IN_FLIGHT"));
        };
        const timer = setTimeout(done, this.fakeDelay);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
      return sharp({
        create: {
          width: input.width,
          height: input.height,
          channels: 3,
          background: { r: 0, g: 98, b: 176 },
        },
      })
        .toFormat(input.format)
        .toBuffer();
    }
    try {
      let body: BodyInit;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
      };
      const parameters = {
        model: input.model,
        prompt: input.prompt,
        size: `${input.width}x${input.height}`,
        quality: input.quality,
        output_format: input.format,
        n: 1,
      };
      if (references.length) {
        const form = new FormData();
        for (const [k, v] of Object.entries(parameters)) form.set(k, String(v));
        for (const [i, bytes] of references.entries()) {
          const type =
            bytes[0] === 0x89
              ? "image/png"
              : bytes[0] === 0xff
                ? "image/jpeg"
                : "image/webp";
          form.append(
            "image[]",
            new Blob([Buffer.from(bytes)], { type }),
            `reference-${i}.${type.split("/")[1]}`,
          );
        }
        body = form;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(parameters);
      }
      const response = await this.fetcher(
        `${config.baseUrl}/${references.length ? "images/edits" : "images/generations"}`,
        { method: "POST", headers, body, redirect: "error", signal },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new ImageCallError(
          [400, 401, 403, 404, 422, 429].includes(response.status)
            ? "rejected"
            : "unknown",
          response.status === 429 ? "UPSTREAM_RATE_LIMIT" : "UPSTREAM_FAILURE",
          response.status,
        );
      }
      let json = JSON.parse(await bounded(response));
      if (typeof json === "string") json = JSON.parse(json);
      const value = json?.data?.[0]?.b64_json;
      if (
        !Array.isArray(json?.data) ||
        json.data.length !== 1 ||
        typeof value !== "string" ||
        value.length > 28 * 1024 * 1024 ||
        value.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
      )
        throw new ImageCallError("unknown", "UNSUPPORTED_RESPONSE");
      return Buffer.from(value, "base64");
    } catch (e) {
      if (e instanceof ImageCallError) throw e;
      throw new ImageCallError(
        "unknown",
        signal.aborted ? "CALL_INTERRUPTED" : "RESULT_UNKNOWN",
      );
    }
  }
}
