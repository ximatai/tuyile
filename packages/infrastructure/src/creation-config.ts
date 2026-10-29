import { resolve, isAbsolute } from "node:path";
export function creationConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!/^[a-f0-9]{64}$/.test(env.APP_MASTER_KEY ?? ""))
    throw new Error("APP_MASTER_KEY_REQUIRED_RUN_ENV_INIT");
  if (
    env.NODE_ENV === "production" &&
    (!env.STORAGE_DIR || !isAbsolute(env.STORAGE_DIR))
  )
    throw new Error("PRODUCTION_STORAGE_DIR_REQUIRED");
  return {
    masterKey: env.APP_MASTER_KEY!,
    root: resolve(env.STORAGE_DIR ?? ".codex-temp/dev-storage"),
    fakeAllowed: env.NODE_ENV !== "production",
    fakeDelay: Math.max(
      0,
      Math.min(10000, Number(env.FAKE_IMAGE_DELAY_MS ?? 700)),
    ),
  };
}
