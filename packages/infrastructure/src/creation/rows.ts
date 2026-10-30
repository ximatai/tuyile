import type { ImageInput, ImagePolicy, ImageTask } from "@tuyile/contracts";
/** PostgreSQL values used by the creation adapters; never exposed as API DTOs. */
export interface TaskRow {
  agent_plan_id: string | null;
  step_index: number | null;
  depends_on: string | null;
  id: string;
  workspace_id: string;
  project_id: string;
  user_id: string;
  input_hash: string;
  request_key: string;
  input: ImageInput & { finalPrompt?: string };
  policy: ImagePolicy;
  provider_id: string;
  tool_id: string;
  tool_version: number;
  execution_version: number;
  day: string;
  state: ImageTask["state"];
  used: number;
  held: number;
  pending_review: boolean;
  cancel_requested: boolean;
  error_code: string | null;
  created_at: Date;
  deadline: Date;
  resolved_at: Date | null;
  storage_remaining: string;
}
export interface AssetRow {
  id: string;
  workspace_id: string;
  user_id: string;
  file_key: string;
  state: "staging" | "ready" | "deleting" | "deleted";
  mime: string | null;
  width: number | null;
  height: number | null;
  hash: string | null;
  bytes: string;
  preview_bytes: string;
  reserved_bytes: string;
  task_id: string | null;
  ordinal: number | null;
  created_at: Date;
}
export interface OutputRow extends AssetRow {
  task_id: string;
  output_id: string;
}
export interface PolicyRow {
  image_limit: number;
  attempts_limit: number;
  storage_limit: string;
  storage_used: string;
  storage_reserved: string;
  concurrency: number;
  queue_limit: number;
  max_edge: number;
  max_pixels: number;
  max_count: number;
  max_quality: ImagePolicy["maxQuality"];
  allowed_models: string[];
}
