import { z } from "zod";
export const favoriteInput = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(100),
    groupName: z.string().trim().max(60).default(""),
    assetId: z.uuid().optional(),
    prompt: z.string().trim().min(1).max(12000).optional(),
  })
  .strict()
  .refine((v) => !!v.assetId !== !!v.prompt, {
    message: "Choose an image or a prompt",
  });
export type FavoriteInput = z.infer<typeof favoriteInput>;
export interface Favorite extends FavoriteInput {
  createdAt: string;
}
export interface GalleryAsset {
  id: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
  origin: "upload" | "generated";
}
export interface AssetReference {
  kind: "canvas" | "task" | "agent" | "favorite";
  id: string;
  label: string;
  projectId: string | null;
}
export interface PromptTemplate {
  id: string;
  title: string;
  category: string;
  prompt: string;
}
export const libraryExportInput = z
  .object({ assetIds: z.array(z.uuid()).min(1).max(5) })
  .strict();
