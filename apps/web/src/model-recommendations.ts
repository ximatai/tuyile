import {
  imageModelKnowledge,
  type ModelKind,
  type PoolEntryInput,
} from "@tuyile/contracts";

export function conversationModelKnowledge(model: string) {
  if (model !== "gpt-6.1-terra") return undefined;
  return {
    source: "https://developers.openai.com/api/docs/models/gpt-6.1-terra",
    checkedAt: "2026-10-30",
    supportsImages: true,
  };
}
// Product budgets are deliberately smaller than provider maxima.
export function recommendedModelCapabilities(
  model: string,
  kind: ModelKind,
): Pick<PoolEntryInput, "image" | "conversation"> {
  if (kind === "conversation")
    return {
      conversation: {
        supportsImages:
          conversationModelKnowledge(model)?.supportsImages ?? false,
        responseMode: "json_object",
        maxOutputTokens: 4096,
        maxInputCharacters: 32000,
      },
    };
  const known = imageModelKnowledge(model);
  return {
    image: {
      model,
      generation: true,
      editing: !!known,
      maxReferences: known ? 4 : 0,
      maxEdge: known?.maxEdge ?? 1024,
      maxPixels: known?.maxPixels ?? 1048576,
      sizes: known ? [] : ["1024x1024"],
      qualities: known ? [...known.qualities] : ["medium"],
      formats: known ? [...known.formats] : ["png"],
    },
  };
}
