import type {
  Principal,
  Project,
  UserView,
  LinkResult,
} from "@tuyile/contracts";
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number = 400,
  ) {
    super(code);
  }
}
export interface UserRecord extends UserView {
  passwordHash: string | null;
  executionVersion: number;
}
export interface SessionRecord {
  tokenHash: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
}
export interface TokenRecord {
  userId: string;
  kind: "activate" | "reset";
  expiresAt: Date;
}
export interface Repository {
  userByName(name: string): Promise<UserRecord | null>;
  userById(id: string, lock?: boolean): Promise<UserRecord | null>;
  bootstrapLock(): Promise<void>;
  userCount(): Promise<number>;
  createUser(
    name: string,
    role: "admin" | "member",
    passwordHash: string | null,
  ): Promise<UserRecord>;
  setPassword(id: string, hash: string | null): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  revokeUser(id: string): Promise<void>;
  listUsers(offset?: number): Promise<UserView[]>;
  createToken(
    userId: string,
    kind: "activate" | "reset",
    hash: string,
    expiresAt: Date,
  ): Promise<void>;
  tokenByHash(hash: string): Promise<TokenRecord | null>;
  deleteTokens(userId: string): Promise<void>;
  createSession(session: SessionRecord): Promise<void>;
  sessionByHash(
    hash: string,
  ): Promise<{ principal: Principal; session: SessionRecord } | null>;
  deleteSession(hash: string): Promise<void>;
  consumeLoginBudget(key: string, limit?: number): Promise<boolean>;
  listProjects(workspaceId: string, offset?: number): Promise<Project[]>;
  projectById(workspaceId: string, id: string): Promise<Project | null>;
  createProject(workspaceId: string, name: string): Promise<Project>;
}
export interface Store {
  transaction<T>(work: (r: Repository) => Promise<T>): Promise<T>;
}
export interface Security {
  random(): string;
  digest(value: string): string;
  hashPassword(value: string): Promise<string>;
  verifyPassword(value: string, hash: string | null): Promise<boolean>;
}
export class Workbench {
  constructor(
    private store: Store,
    private security: Security,
    private now = () => new Date(),
  ) {}
  private expiry(hours: number) {
    return new Date(this.now().getTime() + hours * 3600000);
  }
  private async actor(r: Repository, p: Principal, admin = false) {
    const u = await r.userById(p.id, true);
    if (!u || !u.enabled || u.executionVersion !== p.executionVersion)
      throw new AppError("UNAUTHENTICATED", 401);
    if (admin && u.role !== "admin") throw new AppError("FORBIDDEN", 403);
    return u;
  }
  async bootstrap(name: string, password: string) {
    const hash = await this.security.hashPassword(password);
    return this.store.transaction(async (r) => {
      await r.bootstrapLock();
      if (await r.userCount()) throw new AppError("ALREADY_INITIALIZED", 409);
      return r.createUser(name, "admin", hash);
    });
  }
  async login(name: string, password: string) {
    const permitted = await this.store.transaction((r) =>
      r.consumeLoginBudget(this.security.digest(name)),
    );
    if (!permitted) throw new AppError("RATE_LIMITED", 429);
    const candidate = await this.store.transaction((r) => r.userByName(name));
    const valid = await this.security.verifyPassword(
      password,
      candidate?.passwordHash ?? null,
    );
    if (!valid || !candidate) throw new AppError("INVALID_CREDENTIALS", 401);
    return this.store.transaction(async (r) => {
      const u = await r.userById(candidate.id, true);
      if (
        !u ||
        !u.enabled ||
        !u.activated ||
        u.passwordHash !== candidate.passwordHash
      )
        throw new AppError("INVALID_CREDENTIALS", 401);
      const token = this.security.random(),
        csrfToken = this.security.random(),
        expiresAt = this.expiry(24 * 7);
      await r.createSession({
        tokenHash: this.security.digest(token),
        userId: u.id,
        csrfToken,
        expiresAt,
      });
      return { token, csrfToken, expiresAt };
    });
  }
  async authenticate(token: string | undefined) {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new AppError("UNAUTHENTICATED", 401);
    const result = await this.store.transaction((r) =>
      r.sessionByHash(this.security.digest(token)),
    );
    if (
      !result ||
      result.session.expiresAt <= this.now() ||
      !result.principal.enabled
    )
      throw new AppError("UNAUTHENTICATED", 401);
    return { user: result.principal, csrfToken: result.session.csrfToken };
  }
  async logout(token: string) {
    await this.store.transaction((r) =>
      r.deleteSession(this.security.digest(token)),
    );
  }
  async users(p: Principal, offset = 0) {
    return this.store.transaction(async (r) => {
      await this.actor(r, p, true);
      return r.listUsers(offset);
    });
  }
  private async link(
    r: Repository,
    u: UserRecord,
    kind: "activate" | "reset",
  ): Promise<LinkResult> {
    const token = this.security.random(),
      expiresAt = this.expiry(kind === "activate" ? 24 : 1);
    await r.deleteTokens(u.id);
    await r.createToken(u.id, kind, this.security.digest(token), expiresAt);
    const { passwordHash: _, executionVersion: __, ...user } = u;
    return { user, token, kind, expiresAt: expiresAt.toISOString() };
  }
  async createUser(p: Principal, name: string) {
    return this.store.transaction(async (r) => {
      await this.actor(r, p, true);
      return this.link(r, await r.createUser(name, "member", null), "activate");
    });
  }
  async reset(p: Principal, userId: string) {
    return this.store.transaction(async (r) => {
      await r.bootstrapLock(); // Serializes multi-user admin mutations with one consistent lock order.
      for (const id of [...new Set([p.id, userId])].sort())
        await r.userById(id, true);
      await this.actor(r, p, true);
      const u = await r.userById(userId, true);
      if (!u) throw new AppError("NOT_FOUND", 404);
      if (!u.enabled) throw new AppError("ACCOUNT_DISABLED", 409);
      await r.setPassword(userId, null);
      await r.revokeUser(userId);
      return this.link(
        r,
        { ...u, passwordHash: null, activated: false },
        "reset",
      );
    });
  }
  // Deployment-side recovery only; no HTTP adapter exposes this use case.
  async recoverAdmin(name: string) {
    return this.store.transaction(async (r) => {
      await r.bootstrapLock();
      const found = await r.userByName(name);
      if (!found) throw new AppError("NOT_FOUND", 404);
      const u = await r.userById(found.id, true);
      if (!u || u.role !== "admin" || !u.enabled)
        throw new AppError("NOT_FOUND", 404);
      await r.setPassword(u.id, null);
      await r.revokeUser(u.id);
      return this.link(
        r,
        { ...u, passwordHash: null, activated: false },
        "reset",
      );
    });
  }
  async enable(p: Principal, userId: string, enabled: boolean) {
    return this.store.transaction(async (r) => {
      await r.bootstrapLock();
      for (const id of [...new Set([p.id, userId])].sort())
        await r.userById(id, true);
      await this.actor(r, p, true);
      if (userId === p.id && !enabled)
        throw new AppError("CANNOT_DISABLE_SELF", 409);
      const u = await r.userById(userId, true);
      if (!u) throw new AppError("NOT_FOUND", 404);
      if (u.enabled !== enabled) {
        await r.setEnabled(userId, enabled);
        if (!enabled) {
          await r.revokeUser(userId);
          await r.deleteTokens(userId);
        }
      }
    });
  }
  async redeem(token: string, password: string, kind: "activate" | "reset") {
    const tokenHash = this.security.digest(token);
    const hash = await this.security.hashPassword(password);
    return this.store.transaction(async (r) => {
      const first = await r.tokenByHash(tokenHash);
      if (!first) throw new AppError("INVALID_LINK", 400);
      const u = await r.userById(first.userId, true);
      const record = await r.tokenByHash(tokenHash);
      if (
        !record ||
        record.kind !== kind ||
        record.expiresAt <= this.now() ||
        !u?.enabled ||
        (kind === "activate" && u.activated)
      )
        throw new AppError("INVALID_LINK", 400);
      await r.setPassword(u.id, hash);
      await r.revokeUser(u.id);
      await r.deleteTokens(u.id);
    });
  }
  async changePassword(p: Principal, current: string, password: string) {
    const u = await this.store.transaction((r) => r.userById(p.id));
    if (!(await this.security.verifyPassword(current, u?.passwordHash ?? null)))
      throw new AppError("INVALID_CREDENTIALS", 401);
    const hash = await this.security.hashPassword(password);
    return this.store.transaction(async (r) => {
      const latest = await this.actor(r, p);
      if (latest.passwordHash !== u?.passwordHash)
        throw new AppError("UNAUTHENTICATED", 401);
      await r.setPassword(p.id, hash);
      await r.revokeUser(p.id);
      await r.deleteTokens(p.id);
    });
  }
  async projects(p: Principal, offset = 0) {
    return this.store.transaction(async (r) => {
      await this.actor(r, p);
      return r.listProjects(p.workspaceId, offset);
    });
  }
  async project(p: Principal, id: string) {
    return this.store.transaction(async (r) => {
      await this.actor(r, p);
      const v = await r.projectById(p.workspaceId, id);
      if (!v) throw new AppError("NOT_FOUND", 404);
      return v;
    });
  }
  async createProject(p: Principal, name: string) {
    return this.store.transaction(async (r) => {
      await this.actor(r, p);
      return r.createProject(p.workspaceId, name);
    });
  }
}
export * from "./creation.js";
export type { ImageExecutionConfig } from "./provider-config.js";

export { checkAdmissionBudget, completedTaskState } from "./creation-policy.js";
export * from "./tools.js";
export * from "./capabilities.js";
export * from "./extensions.js";
