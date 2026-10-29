import { describe, it, expect } from "vitest";
import { security, loadConfig } from "@tuyile/infrastructure";
import { createProjectInput, username, password } from "@tuyile/contracts";
describe("security and boundary rules", () => {
  it("salts passwords and safely rejects mismatches/malformed hashes", async () => {
    const first = await security.hashPassword("synthetic-password-123"),
      second = await security.hashPassword("synthetic-password-123");
    expect(first).not.toBe(second);
    expect(await security.verifyPassword("synthetic-password-123", first)).toBe(
      true,
    );
    expect(await security.verifyPassword("different", first)).toBe(false);
    expect(await security.verifyPassword("different", null)).toBe(false);
  });
  it("keeps production HTTPS and explicit config", () => {
    expect(() => loadConfig({})).toThrow("DATABASE_URL_REQUIRED");
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://unused",
        NODE_ENV: "production",
        APP_ORIGIN: "http://example.test",
      }),
    ).toThrow("PRODUCTION_REQUIRES_HTTPS");
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://unused",
        APP_ORIGIN: "https://example.test/path",
      }),
    ).toThrow("INVALID_APP_ORIGIN");
  });
  it("normalizes names without accepting empty projects or short passwords", () => {
    expect(username.parse(" TEST.USER ")).toBe("test.user");
    expect(() => createProjectInput.parse({ name: "  " })).toThrow();
    expect(() => password.parse("short")).toThrow();
  });
});
