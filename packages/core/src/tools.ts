import { composeCreativePrompt } from "@tuyile/contracts";
import {
  imageInput,
  toolBinding,
  type ImageInput,
  type ToolBinding,
  type ToolView,
} from "@tuyile/contracts";
import { AppError } from "./index.js";
export interface ToolContext {
  readonly signal: AbortSignal;
  /** Platform owns authorization, parameters, dispatch, attempts and settlement. */
  generate(): Promise<Uint8Array>;
}
export interface TrustedImageTool {
  readonly definition: Omit<ToolView, "enabled" | "revoked">;
  execute(
    input: Readonly<ImageInput>,
    context: ToolContext,
  ): Promise<Uint8Array>;
}
export class ToolRegistry {
  private readonly tools = new Map<string, TrustedImageTool>();
  register(tool: TrustedImageTool) {
    const d = tool.definition;
    toolBinding.parse({ id: d.id, version: d.version });
    if (
      d.permission !== "image:create" ||
      d.effect !== "one-image" ||
      d.externalAccess !== "configured-image-provider" ||
      d.inputSchema !== "image-input-v1" ||
      d.outputSchema !== "image-bytes-v1" ||
      d.minReferences < 0 ||
      d.maxReferences > 4 ||
      d.minReferences > d.maxReferences
    )
      throw new AppError("INVALID_TOOL_DEFINITION", 400);
    const key = `${d.id}@${d.version}`;
    if (this.tools.has(key)) throw new AppError("TOOL_VERSION_CONFLICT", 409);
    this.tools.set(key, {
      definition: Object.freeze({ ...d }),
      execute: tool.execute.bind(tool),
    });
    return this;
  }
  require(binding: ToolBinding) {
    const t = this.tools.get(`${binding.id}@${binding.version}`);
    if (!t) throw new AppError("TOOL_VERSION_UNAVAILABLE", 409);
    return t;
  }
  list(): ToolView[] {
    return [...this.tools.values()].map((t) => ({
      ...t.definition,
      enabled: true,
      revoked: false,
    }));
  }
  validate(binding: ToolBinding, input: ImageInput) {
    const parsed = imageInput.parse(input),
      t = this.require(binding);
    if (composeCreativePrompt(parsed).length > 12000)
      throw new AppError("PROMPT_TOO_LONG", 400);
    if (
      parsed.referenceIds.length < t.definition.minReferences ||
      parsed.referenceIds.length > t.definition.maxReferences
    )
      throw new AppError("TOOL_INPUT_UNSUPPORTED", 409);
    return parsed;
  }
  async execute(binding: ToolBinding, input: ImageInput, context: ToolContext) {
    const parsed = this.validate(binding, input),
      tool = this.require(binding);
    let calls = 0;
    const result = await tool.execute(
      Object.freeze({
        ...parsed,
        referenceIds: Object.freeze([
          ...parsed.referenceIds,
        ]) as unknown as string[],
      }),
      {
        signal: context.signal,
        generate: async () => {
          if (++calls !== 1) throw new AppError("TOOL_EFFECT_LIMIT", 409);
          if (context.signal.aborted) throw new AppError("TASK_STOPPED", 409);
          return context.generate();
        },
      },
    );
    if (
      calls !== 1 ||
      !(result instanceof Uint8Array) ||
      result.length === 0 ||
      result.length > 20 * 1024 * 1024
    )
      throw new AppError("INVALID_TOOL_OUTPUT", 409);
    return result;
  }
}
export const defaultTool = (
  input: Pick<ImageInput, "referenceIds">,
): ToolBinding => ({
  id: input.referenceIds.length ? "image.edit" : "image.generate",
  version: 1,
});
export function createToolRegistry() {
  const registry = new ToolRegistry();
  for (const [id, name, minReferences, maxReferences] of [
    ["image.generate", "生成图片", 0, 0],
    ["image.edit", "参考图创作", 1, 4],
  ] as const)
    registry.register({
      definition: {
        id,
        version: 1,
        name,
        minReferences,
        maxReferences,
        inputSchema: "image-input-v1",
        outputSchema: "image-bytes-v1",
        permission: "image:create",
        externalAccess: "configured-image-provider",
        effect: "one-image",
      },
      execute: (_input, ctx) => ctx.generate(),
    });
  return registry;
}
