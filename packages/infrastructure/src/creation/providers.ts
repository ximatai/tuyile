import { AppError } from "@tuyile/core";
import type { Principal, ProviderInput, ProviderView } from "@tuyile/contracts";
import { PgCreationContext } from "./context.js";
export class PgProvidersRepository extends PgCreationContext {
  async current(): Promise<{ id: string; models: string[] }> {
    const row = (
      await this.c.query(
        "SELECT id,models FROM image_provider_versions WHERE active AND NOT revoked",
      )
    ).rows[0];
    if (!row) throw new AppError("PROVIDER_NOT_CONFIGURED", 409);
    return { id: row.id, models: row.models };
  }

  private providerView(r: {
    id: string;
    mode: "fake" | "openai";
    base_url: string;
    models: string[];
    active: boolean;
    revoked: boolean;
  }): ProviderView {
    return {
      id: r.id,
      mode: r.mode,
      baseUrl: r.base_url,
      models: r.models,
      active: r.active,
      revoked: r.revoked,
      configured: true,
    };
  }
  async saveProvider(p: Principal, input: ProviderInput) {
    const c = this.c;

    await this.auth(c, p, true);
    await c.query("SELECT pg_advisory_xact_lock(72110405)");
    if (input.mode === "fake" && !this.fakeAllowed)
      throw new AppError("FAKE_PROVIDER_DISABLED", 403);
    if (input.mode === "openai") {
      let u: URL;
      try {
        u = new URL(input.baseUrl);
      } catch {
        throw new AppError("INVALID_PROVIDER_URL", 400);
      }
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw new AppError("INVALID_PROVIDER_URL", 400);
    }
    const current = (
      await c.query("SELECT * FROM image_provider_versions WHERE active")
    ).rows[0];
    const secret =
      input.mode === "fake"
        ? ""
        : (input.apiKey ??
          (input.preserveKey &&
          current &&
          current.mode === "openai" &&
          current.base_url === input.baseUrl.replace(/\/$/, "")
            ? this.decrypt(current.secret_cipher)
            : ""));
    if (input.mode === "openai" && !secret)
      throw new AppError("API_KEY_REQUIRED", 400);
    if (current)
      await c.query(
        "UPDATE image_provider_versions SET active=false WHERE id=$1",
        [current.id],
      );
    const r = (
      await c.query(
        "INSERT INTO image_provider_versions(mode,base_url,models,secret_cipher) VALUES($1,$2,$3,$4) RETURNING *",
        [
          input.mode,
          input.mode === "fake" ? "" : input.baseUrl.replace(/\/$/, ""),
          JSON.stringify([...new Set(input.models)]),
          this.encrypt(secret),
        ],
      )
    ).rows[0];
    return this.providerView(r);
  }
  async providers(p: Principal) {
    const c = this.c;

    await this.auth(c, p, true, false);
    return (
      await c.query(
        "SELECT id,mode,base_url,models,active,revoked FROM image_provider_versions ORDER BY created_at DESC LIMIT 50",
      )
    ).rows.map((r) => this.providerView(r));
  }
  async revokeProvider(p: Principal, id: string) {
    const c = this.c;

    await this.auth(c, p, true);
    if (
      !(
        await c.query(
          "UPDATE image_provider_versions SET revoked=true,active=false WHERE id=$1 RETURNING id",
          [id],
        )
      ).rowCount
    )
      throw new AppError("NOT_FOUND", 404);
  }
}
