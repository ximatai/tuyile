import {
  AppError,
  type ModelDirectory,
  type DirectoryConfig,
} from "@tuyile/core";
import { modelId } from "@tuyile/contracts";
export class CompatibleModelDirectory implements ModelDirectory {
  constructor(
    private fakeAllowed = false,
    private request: typeof fetch = fetch,
  ) {}
  async list(config: DirectoryConfig, signal: AbortSignal) {
    if (config.mode === "fake") {
      if (!this.fakeAllowed) throw new AppError("FAKE_PROVIDER_DISABLED", 403);
      return ["test-image", "test-planner"];
    }
    let response: Response;
    try {
      response = await this.request(config.baseUrl + "/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        redirect: "error",
        signal,
      });
    } catch {
      throw new AppError("MODEL_DIRECTORY_UNAVAILABLE", 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError("MODEL_DIRECTORY_REJECTED", 502);
    }
    if (Number(response.headers.get("content-length")) > 1048576) {
      await response.body?.cancel();
      throw new AppError("MODEL_DIRECTORY_LIMIT", 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError("MODEL_DIRECTORY_INVALID", 502);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 1048576) throw new AppError("MODEL_DIRECTORY_LIMIT", 502);
        chunks.push(part.value);
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("MODEL_DIRECTORY_UNAVAILABLE", 502);
    } finally {
      await reader.cancel().catch(() => {});
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(value.data) || value.data.length > 2000) throw Error();
      const ids = [
        ...new Set<string>(
          value.data.map((v: { id: unknown }) => modelId.parse(v.id)),
        ),
      ].sort();
      if (!ids.length) throw Error();
      return ids;
    } catch {
      throw new AppError("MODEL_DIRECTORY_INVALID", 502);
    }
  }
}
