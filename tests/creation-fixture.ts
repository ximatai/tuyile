import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  PgCreationRepository,
  PrivateImageFiles,
  ImageWorker,
  CompatibleImageProvider,
} from "@tuyile/infrastructure";
import {
  CreationService,
  type ImageProvider,
  type ImageFiles,
  type WorkItem,
} from "@tuyile/core";
import type { ImageInput } from "@tuyile/contracts";
import { resetDatabase, testPassword } from "./test-database.js";
export async function imageFixture() {
  const db = await resetDatabase(),
    login = await db.service.login("admin", testPassword),
    principal = (await db.service.authenticate(login.token)).user;
  const repo = new PgCreationRepository(
      db.pool,
      process.env.APP_MASTER_KEY!,
      true,
    ),
    root = await mkdtemp(".codex-temp/image-test-"),
    files = new PrivateImageFiles(root, 0),
    creation = new CreationService(repo, files);
  await files.init();
  await repo.saveProvider(principal, {
    mode: "fake",
    baseUrl: "",
    models: ["test-image"],
    preserveKey: false,
  });
  const project = await db.service.createProject(
    principal,
    "Synthetic image project",
  );
  const workers: ImageWorker[] = [];
  function input(extra: Partial<ImageInput> = {}): ImageInput {
    return {
      projectId: project.id,
      requestKey: randomUUID(),
      prompt: "Synthetic private prompt",
      model: "test-image",
      width: 256,
      height: 256,
      quality: "medium",
      format: "png",
      count: 1,
      referenceIds: [],
      ...extra,
    };
  }
  async function worker(
    provider: ImageProvider = new CompatibleImageProvider(true, 50),
    imageFiles: ImageFiles = files,
  ) {
    let fatal = false;
    const w = new ImageWorker(db.pool, repo, imageFiles, provider, () => {
      fatal = true;
    });
    workers.push(w);
    await w.start();
    return { worker: w, fatal: () => fatal };
  }
  async function done(id: string) {
    for (let n = 0; n < 200; n++) {
      const t = await repo.task(principal, id);
      if (!["queued", "running"].includes(t.state)) return t;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("TASK_NOT_FINISHED");
  }
  async function cleanup() {
    for (const w of workers) await w.stop();
    await db.pool.end();
    await rm(root, { recursive: true, force: true });
  }
  const png = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#0062b0" },
  })
    .png()
    .toBuffer();
  return {
    ...db,
    principal,
    login,
    repo,
    root,
    files,
    creation,
    project,
    input,
    worker,
    done,
    cleanup,
    png,
  };
}
