import { z } from "zod";

export const externalAgentScope = z.enum([
  "canvas:read",
  "canvas:write",
  "images:generate",
]);
export type ExternalAgentScope = z.infer<typeof externalAgentScope>;

export interface ExternalAgentGrant {
  expiresAt: string;
  scopes: ExternalAgentScope[];
}
export interface ExternalAgentConnection {
  grant: ExternalAgentGrant | null;
}
