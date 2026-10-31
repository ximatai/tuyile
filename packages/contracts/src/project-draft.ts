import { z } from "zod";
// Drafts accept incomplete input; execution applies the stricter creation schemas.
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes("\0"));
const draftStyle = z.object({ name: text(80), text: text(2000) }).strict();
export const draftSettings = z
  .object({
    modelKey: text(200),
    width: z.number().int().min(0).max(8192),
    height: z.number().int().min(0).max(8192),
    quality: z.enum(["low", "medium", "high"]),
    format: z.enum(["png", "jpeg", "webp"]),
    count: z.number().int().min(1).max(16),
  })
  .strict();
const draftInput = z
  .object({
    prompt: text(12000),
    style: draftStyle.optional(),
    settings: draftSettings,
  })
  .strict();
export const projectDraftDocument = z
  .object({
    direct: draftInput,
    agent: draftInput
      .extend({ conversationModel: text(200), skillId: text(200) })
      .strict(),
    referenceIds: z
      .array(z.uuid())
      .max(4)
      .refine((ids) => new Set(ids).size === ids.length),
    mode: z.enum(["direct", "agent"]),
  })
  .strict();
export type ProjectDraftDocument = z.infer<typeof projectDraftDocument>;
export const projectDraftSave = z
  .object({
    revision: z.number().int().min(0).max(2147483646),
    requestKey: z.uuid(),
    document: projectDraftDocument,
  })
  .strict();
export type ProjectDraftSave = z.infer<typeof projectDraftSave>;
export interface ProjectDraftSnapshot {
  revision: number;
  document: ProjectDraftDocument;
}
export function emptyProjectDraft(): ProjectDraftDocument {
  const settings = {
    modelKey: "",
    width: 1024,
    height: 1024,
    quality: "medium" as const,
    format: "png" as const,
    count: 1,
  };
  return {
    direct: { prompt: "", settings: { ...settings } },
    agent: {
      prompt: "",
      settings: { ...settings },
      conversationModel: "",
      skillId: "",
    },
    referenceIds: [],
    mode: "direct",
  };
}
