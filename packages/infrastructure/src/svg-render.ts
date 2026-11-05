import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AppError } from "@tuyile/core";
import { validateSvg } from "./svg-validation.js";
let active = 0;
/** Killable rendering, bounded process count, wall/CPU time, V8 heap, RSS and output. */
export async function rasterizeSvg(
  bytes: Uint8Array,
  limits: { wallMs?: number; rssKiB?: number } = {},
): Promise<Uint8Array> {
  validateSvg(bytes);
  if (active >= 2) throw new AppError("SVG_RENDERER_BUSY", 503);
  active++;
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const source = import.meta.url.endsWith(".ts");
      const entry = fileURLToPath(
        new URL(
          source ? "./svg-render-worker.ts" : "../svg/render.js",
          import.meta.url,
        ),
      );
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=64",
          ...(source ? ["--import", "tsx"] : []),
          entry,
        ],
        {
          env: {
            PATH: process.env.PATH!,
            LANG: "C.UTF-8",
            VIPS_CONCURRENCY: "1",
            MALLOC_ARENA_MAX: "2",
          },
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      let failed = false,
        length = 0,
        reading = false;
      const chunks: Buffer[] = [];
      const kill = () => {
        failed = true;
        child.kill("SIGKILL");
      };
      const timeout = setTimeout(kill, Math.min(limits.wallMs ?? 4000, 4000));
      const memory = setInterval(() => {
        if (!child.pid || reading) return;
        reading = true;
        execFile(
          "/bin/ps",
          ["-o", "rss=", "-p", String(child.pid)],
          { timeout: 300, maxBuffer: 1024 },
          (error, stdout) => {
            reading = false;
            if (
              (!error &&
                Number(stdout.trim()) >
                  Math.min(limits.rssKiB ?? 256 * 1024, 256 * 1024)) ||
              (error && child.exitCode === null && !child.killed)
            )
              kill();
          },
        );
      }, 100);
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 20 * 1024 * 1024) kill();
        else chunks.push(chunk);
      });
      child.stdin.on("error", () => {});
      child.on("error", () => {
        failed = true;
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        clearInterval(memory);
        if (failed || code !== 0 || !length)
          reject(new AppError("SVG_PREVIEW_FAILED", 422));
        else resolve(Buffer.concat(chunks));
      });
      child.stdin.end(bytes);
    });
  } finally {
    active--;
  }
}
