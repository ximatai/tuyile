import { z } from "zod";
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/);
export const password = z.string().min(12).max(128);
export const loginInput = z.object({
  username,
  password: z.string().min(1).max(128),
});
export const createUserInput = z.object({ username });
export const redeemInput = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password,
});
export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(128),
  password,
});
export const createProjectInput = z.object({
  name: z.string().trim().min(1).max(80),
});
export const id = z.uuid();
export interface UserView {
  id: string;
  username: string;
  role: "admin" | "member";
  enabled: boolean;
  activated: boolean;
  mustChangePassword?: boolean;
}
export interface TemporaryPasswordResult {
  user: UserView;
  temporaryPassword: string;
  expiresAt: string;
}
export interface Principal extends UserView {
  workspaceId: string;
  executionVersion: number;
}
export interface SessionView {
  user: Principal;
  csrfToken: string;
}
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
}
export interface LinkResult {
  user: UserView;
  token: string;
  kind: "activate" | "reset";
  expiresAt: string;
}
export interface ErrorResponse {
  error: { code: string; requestId: string };
}
export { z };

export interface ProjectsPage {
  projects: Project[];
  hasMore: boolean;
}
export interface UsersPage {
  users: UserView[];
  hasMore: boolean;
}
export const pageOffset = z.coerce.number().int().min(0).max(100000).default(0);
export * from "./creation.js";
export * from "./extensions.js";
export * from "./canvas.js";
export * from "./agent.js";
export * from "./library.js";
export * from "./administration.js";
export * from "./model-catalog.js";

export * from "./image-model-knowledge.js";
