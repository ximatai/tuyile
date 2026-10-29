export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl))
    throw new Error("DATABASE_URL_REQUIRED");
  const origin = env.APP_ORIGIN ?? "http://127.0.0.1:5178";
  const url = new URL(origin);
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol))
    throw new Error("INVALID_APP_ORIGIN");
  const production = env.NODE_ENV === "production";
  if (production && url.protocol !== "https:")
    throw new Error("PRODUCTION_REQUIRES_HTTPS");
  const port = Number(env.PORT ?? "8791");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("INVALID_PORT");
  return {
    databaseUrl,
    origin,
    production,
    port,
    host: env.HOST ?? "127.0.0.1",
  };
}
