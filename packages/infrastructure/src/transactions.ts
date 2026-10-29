import type pg from "pg";

/** Shared transaction boundary; owners are locked before domain rows. */
export class PgTransactions {
  constructor(private readonly pool: pg.Pool) {}
  async write<T>(
    run: (c: pg.PoolClient) => Promise<T>,
    owners: string[] | ((c: pg.PoolClient) => Promise<string[]>),
    queue = false,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      if (queue) await c.query("SELECT pg_advisory_xact_lock(72110403)");
      const ids = typeof owners === "function" ? await owners(c) : owners;
      await c.query(
        "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[...new Set(ids)].sort()],
      );
      const value = await run(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async read<T>(run: (c: pg.PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const value = await run(c);
      await c.query("COMMIT");
      return value;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
}
