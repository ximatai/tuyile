import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import type { Security } from "@tuyile/core";
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
export const security: Security = {
  random: () => randomBytes(32).toString("hex"),
  digest: (value) => createHash("sha256").update(value).digest("hex"),
  async hashPassword(value) {
    const salt = randomBytes(16).toString("hex");
    return `scrypt$${salt}$${(await derive(value, salt)).toString("hex")}`;
  },
  async verifyPassword(value, encoded) {
    const valid = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded ?? "");
    const [, salt, hash] = valid
      ? encoded!.split("$")
      : ["scrypt", "0".repeat(32), "0".repeat(128)];
    const actual = await derive(value, salt);
    return timingSafeEqual(actual, Buffer.from(hash, "hex")) && valid;
  },
};
