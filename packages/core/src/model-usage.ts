/** Only bounded numeric usage is retained; provider response bodies never enter the ledger. */
export interface ModelUsage {
  svg?: {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens: number | null;
    textInputTokens: number | null;
    imageInputTokens: number | null;
    model: string | null;
    requested: unknown;
    reasoningTokens: number | null;
    totalTokens: number | null;
    priceSnapshot: ReferencePrice | null;
    referenceUsd: number | null;
    costBasis: string;
  };
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  textInputTokens: number | null;
  imageInputTokens: number | null;
}
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647
    ? v
    : null;
export function parseModelUsage(
  raw: unknown,
  kind: "image" | "planning",
): ModelUsage {
  const u = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const details =
    kind === "image" ? u.input_tokens_details : u.prompt_tokens_details;
  const inputTokens = count(
    kind === "image" ? u.input_tokens : u.prompt_tokens,
  );
  let cachedInputTokens = count(details?.cached_tokens);
  if (
    inputTokens !== null &&
    cachedInputTokens !== null &&
    cachedInputTokens > inputTokens
  )
    cachedInputTokens = null;
  return {
    inputTokens,
    outputTokens: count(
      kind === "image" ? u.output_tokens : u.completion_tokens,
    ),
    cachedInputTokens,
    textInputTokens:
      kind === "image" ? count(details?.text_tokens) : inputTokens,
    imageInputTokens: kind === "image" ? count(details?.image_tokens) : 0,
  };
}
export interface ReferencePrice {
  version: string;
  source: string;
  kind: "image" | "planning";
  input: number;
  output: number;
  cached: number;
  imageInput?: number;
  long?: [number, number, number];
}
// USD / million tokens. Explicit identities only; aliases are never guessed.
const text: Record<string, [number, number, number, ...number[]]> = {
  "gpt-6.1-terra": [1, 5, 0.05, 2, 7.5, 0.1],
  "gpt-6.1-sol": [2, 10, 0.1, 4, 15, 0.2],
  "gpt-6-astra": [10, 50, 1, 20, 75, 2],
  "gpt-6-sol": [2, 10, 0.2, 4, 15, 0.4],
  "gpt-6-luna": [0.1, 0.5, 0.01, 0.2, 0.75, 0.02],
  "gpt-5.4": [2.5, 15, 0.25, 5, 22.5, 0.5],
  "gpt-5.4-mini": [0.75, 4.5, 0.075],
  "gpt-5.4-nano": [0.2, 1.25, 0.02],
  "gpt-4.1": [2, 8, 0.5],
  "gpt-4.1-mini": [0.4, 1.6, 0.1],
  "gpt-4.1-nano": [0.1, 0.4, 0.025],
  "gpt-4o": [2.5, 10, 1.25],
  "gpt-4o-mini": [0.15, 0.6, 0.075],
  "gpt-5-mini": [0.25, 2, 0.025],
  "gpt-5-nano": [0.05, 0.4, 0.005],
};
export function referencePrice(
  model: string,
  kind: "image" | "planning",
): ReferencePrice | null {
  const base = {
    version: "openai-standard-2026-11-02",
    source: "https://developers.openai.com/api/docs/pricing",
    kind,
  };
  if (kind === "image") {
    if (
      ![
        "gpt-image-2.6-sunburst",
        "gpt-image-2.6-flare",
        "gpt-image-2",
        "gpt-image-2.5-sunburst",
        "gpt-image-2.5-flare",
        "gpt-image-2.5-sunburst-2026-09-08",
        "gpt-image-2.5-flare-2026-09-08",
      ].includes(model)
    )
      return null;
    return {
      ...base,
      ...(model.startsWith("gpt-image-2.6-")
        ? { version: "openai-standard-2026-11-05" }
        : {}),
      input: 5,
      imageInput: 8,
      output: 30,
      cached: 0,
    };
  }
  const p = Object.hasOwn(text, model) ? text[model] : undefined;
  return p
    ? {
        ...base,
        input: p[0],
        output: p[1],
        cached: p[2],
        ...(p.length === 6
          ? { long: [p[3], p[4], p[5]] as [number, number, number] }
          : {}),
      }
    : null;
}
export function referenceCost(
  usage: ModelUsage,
  price: ReferencePrice | null,
): number | null {
  if (!price || usage.inputTokens === null || usage.outputTokens === null)
    return null;
  const { inputTokens: input, outputTokens: output } = usage;
  if (price.kind === "image") {
    if (
      usage.textInputTokens === null ||
      usage.imageInputTokens === null ||
      usage.textInputTokens + usage.imageInputTokens !== input
    )
      return null;
    // Images endpoint has no cached discount for Image 2/2.5 (Responses only).
    const cost =
      (usage.textInputTokens * price.input +
        usage.imageInputTokens * price.imageInput! +
        output * price.output) /
      1e6;
    return Number.isFinite(cost) && cost >= 0 ? cost : null;
  }
  if (usage.cachedInputTokens === null || usage.cachedInputTokens > input)
    return null;
  const rates =
    input > 272000 && price.long
      ? price.long
      : [price.input, price.output, price.cached];
  if (!rates) return null;
  const cost =
    ((input - usage.cachedInputTokens) * rates[0] +
      output * rates[1] +
      usage.cachedInputTokens * rates[2]) /
    1e6;
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function withSvgUsage(
  usage: ModelUsage,
  raw: unknown,
  requested: unknown,
): ModelUsage {
  const u =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const model =
    typeof u.model === "string" && /^[a-zA-Z0-9._-]{1,120}$/.test(u.model)
      ? u.model
      : null;
  const tokens: ModelUsage = {
    inputTokens: count(u.input_tokens),
    outputTokens: count(u.output_tokens),
    cachedInputTokens: null,
    textInputTokens: count(u.input_tokens),
    imageInputTokens: 0,
  };
  const price = model ? referencePrice(model, "planning") : null;
  // svg_usage does not expose cached input: use the conservative full input rate, explicitly recorded.
  const usd =
    price && tokens.inputTokens !== null && tokens.outputTokens !== null
      ? (tokens.inputTokens *
          (tokens.inputTokens > 272000 && price.long
            ? price.long[0]
            : price.input) +
          tokens.outputTokens *
            (tokens.inputTokens > 272000 && price.long
              ? price.long[1]
              : price.output)) /
        1e6
      : null;
  return {
    ...usage,
    svg: {
      ...tokens,
      model,
      requested,
      reasoningTokens: count(u.reasoning_tokens),
      totalTokens: count(u.total_tokens),
      priceSnapshot: price,
      referenceUsd: usd,
      costBasis: "uncached-conservative",
    },
  };
}
