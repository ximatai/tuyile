import sharp from "sharp";
import { mkdir, lstat, open, rename, rm, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  AppError,
  type AssetBytes,
  type ImageFiles,
  type StoredAsset,
} from "@tuyile/core";
export class PrivateImageFiles implements ImageFiles {
  readonly root: string;
  private decoding = 0;
  constructor(
    root: string,
    private lowWaterBytes = 512 * 1024 * 1024,
  ) {
    this.root = resolve(root);
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("INVALID_STORAGE_ROOT");
  }
  private file(key: string, suffix: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("INVALID_FILE_KEY");
    return join(this.root, `${key}.${suffix}`);
  }
  async inspect(bytes: Uint8Array): Promise<AssetBytes> {
    if (bytes.length > 20 * 1024 * 1024 || !bytes.length)
      throw new AppError("UPLOAD_TOO_LARGE", 413);
    if (this.decoding >= 2) throw new AppError("IMAGE_DECODER_BUSY", 503);
    this.decoding++;
    try {
      const image = sharp(bytes, {
        limitInputPixels: 32000000,
        failOn: "warning",
        animated: false,
      });
      const meta = await image.metadata();
      if (
        !meta.width ||
        !meta.height ||
        meta.width > 8192 ||
        meta.height > 8192 ||
        !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
        (meta.pages ?? 1) !== 1
      )
        throw new Error("invalid");
      await image.clone().raw().toBuffer();
      const preview = await image
        .clone()
        .rotate()
        .resize(480, 480, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
      if (preview.length > 1024 * 1024) throw new Error("preview");
      return {
        original: bytes,
        preview,
        mime: `image/${meta.format}`,
        width: meta.width,
        height: meta.height,
        hash: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("INVALID_IMAGE", 400);
    } finally {
      this.decoding--;
    }
  }
  async write(key: string, image: AssetBytes) {
    await this.init();
    for (const [suffix, data] of [
      ["original", image.original],
      ["preview", image.preview],
    ] as const) {
      const temp = this.file(key, `${suffix}.part`);
      const f = await open(temp, "wx", 0o600);
      try {
        await f.writeFile(data);
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(temp, this.file(key, suffix));
    }
    const dir = await open(this.root, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async read(asset: StoredAsset, preview = false) {
    try {
      const f = await open(
        this.file(asset.fileKey, preview ? "preview" : "original"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await f.stat();
        if (
          !stat.isFile() ||
          stat.size > (preview ? 1024 * 1024 : 20 * 1024 * 1024)
        )
          throw new Error("invalid");
        const bytes = await f.readFile();
        if (
          !preview &&
          createHash("sha256").update(bytes).digest("hex") !== asset.hash
        )
          throw new Error("hash");
        return bytes;
      } finally {
        await f.close();
      }
    } catch {
      throw new AppError("ASSET_UNAVAILABLE", 404);
    }
  }
  async remove(key: string) {
    for (const suffix of [
      "original",
      "preview",
      "original.part",
      "preview.part",
    ])
      await rm(this.file(key, suffix), { force: true });
  }
  async freeSpace() {
    await this.init();
    const s = await statfs(this.root);
    return s.bavail * s.bsize >= this.lowWaterBytes;
  }
}
