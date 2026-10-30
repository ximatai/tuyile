import { composeCreativePrompt } from "@tuyile/contracts";
import {
  PlanningCallError,
  type PlanningProvider,
  type PlanningExecutionConfig,
  type PlanningReply,
  type PlanningImage,
} from "@tuyile/core";
export class CompatiblePlanningProvider implements PlanningProvider {
  constructor(
    private readonly fakeAllowed = false,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async complete(
    config: PlanningExecutionConfig,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    budget: number,
    signal: AbortSignal,
    images: readonly PlanningImage[] = [],
  ): Promise<PlanningReply> {
    if (
      !Number.isInteger(budget) ||
      budget < 1 ||
      budget > config.maxOutputTokens ||
      messages.reduce((n, m) => n + m.content.length, 0) >
        config.maxInputCharacters
    )
      throw new PlanningCallError("rejected", "PLANNING_BUDGET_EXCEEDED");
    if (
      images.length &&
      (!config.supportsImages ||
        images.length > 4 ||
        images.some((i) => !i.bytes.length || i.bytes.length > 1024 * 1024))
    )
      throw new PlanningCallError("rejected", "PLANNING_IMAGES_UNSUPPORTED");
    if (signal.aborted)
      throw new PlanningCallError("rejected", "PLANNING_CANCELLED");
    if (config.mode === "fake") {
      if (!this.fakeAllowed)
        throw new PlanningCallError("rejected", "FAKE_PROVIDER_DISABLED");
      let steps: unknown[] = [];
      try {
        const input = JSON.parse(
          messages.find((m) => m.role === "user")?.content ?? "{}",
        );
        if (input.prompt && input.model)
          steps = [
            {
              title: "合成创作",
              prompt: composeCreativePrompt(input),
              model: input.model,
              width: input.width,
              height: input.height,
              quality: input.quality,
              format: input.format,
              count: 1,
              referenceIds: input.referenceIds ?? [],
              tool: {
                id: input.referenceIds?.length
                  ? "image.edit"
                  : "image.generate",
                version: 1,
              },
              usePrevious: false,
            },
          ];
      } catch {
        /* Protocol tests may send plain text instead of a creation request. */
      }
      return {
        text: JSON.stringify({ message: "合成规划服务已响应", steps }),
        inputTokens: 1,
        outputTokens: 1,
      };
    }
    try {
      const response = await this.fetcher(
        `${config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          redirect: "error",
          signal,
          body: JSON.stringify({
            model: config.model,
            messages: messages.map((message, index) => {
              if (
                !images.length ||
                index !== messages.map((m) => m.role).lastIndexOf("user")
              )
                return message;
              return {
                ...message,
                content: [
                  { type: "text", text: message.content },
                  ...images.flatMap((image) => [
                    { type: "text", text: `参考图 ID: ${image.assetId}` },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/webp;base64,${Buffer.from(image.bytes).toString("base64")}`,
                        detail: "low",
                      },
                    },
                  ]),
                ],
              };
            }),
            stream: false,
            max_completion_tokens: budget,
            ...(config.responseMode === "json_object"
              ? { response_format: { type: "json_object" } }
              : {}),
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new PlanningCallError(
          [400, 401, 403, 404, 422, 429].includes(response.status)
            ? "rejected"
            : "unknown",
          response.status === 429
            ? "UPSTREAM_RATE_LIMIT"
            : "PLANNING_UPSTREAM_FAILURE",
          response.status,
        );
      }
      const reader = response.body?.getReader();
      if (!reader)
        throw new PlanningCallError("unknown", "PLANNING_RESPONSE_INVALID");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 1024 * 1024)
            throw new PlanningCallError("unknown", "PLANNING_RESPONSE_LIMIT");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const text = json?.choices?.[0]?.message?.content;
      if (
        typeof text !== "string" ||
        !text.length ||
        text.length > 64000 ||
        json.choices.length !== 1
      )
        throw new PlanningCallError("unknown", "PLANNING_RESPONSE_INVALID");
      const tokens = (n: unknown) =>
        typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
      return {
        text,
        inputTokens: tokens(json.usage?.prompt_tokens),
        outputTokens: tokens(json.usage?.completion_tokens),
      };
    } catch (e) {
      if (e instanceof PlanningCallError) throw e;
      throw new PlanningCallError(
        "unknown",
        signal.aborted ? "PLANNING_INTERRUPTED" : "PLANNING_RESULT_UNKNOWN",
      );
    }
  }
}
