/**
 * Integration proof of the least-privilege grant scheme — the test that makes
 * SECURITY.md's "append-only audit log, verified by test insert/update denial"
 * a true statement instead of a claim.
 *
 * Requires a live MySQL with migrations + grants.sql applied, so it is gated:
 *   LEDGERLIGHT_DB_TESTS=1 npm test --workspace @ledgerlight/server
 * Without the flag the suite skips (unit runs and CI-without-DB stay green).
 */
import { afterAll, describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';

const enabled = process.env.LEDGERLIGHT_DB_TESTS === '1';

const base = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? '3306'),
  database: process.env.DB_NAME ?? 'ledgerlight',
};

const appConn = () => mysql.createConnection({
  ...base,
  user: process.env.DB_USER ?? 'ledgerlight',
  password: process.env.DB_PASSWORD ?? 'ledgerlight_dev',
});
const roConn = () => mysql.createConnection({
  ...base,
  user: process.env.DB_RO_USER ?? 'ledgerlight_ro',
  password: process.env.DB_RO_PASSWORD ?? 'ro_dev_change_me',
});

const conns: mysql.Connection[] = [];
async function open(f: () => Promise<mysql.Connection>): Promise<mysql.Connection> {
  const c = await f();
  conns.push(c);
  return c;
}

afterAll(async () => {
  for (const c of conns) await c.end().catch(() => {});
});

/** MySQL denies table/command access with these codes. */
const DENIED = new Set(['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR']);

async function expectDenied(p: Promise<unknown>): Promise<void> {
  try {
    await p;
    expect.unreachable('statement should have been denied by MySQL grants');
  } catch (err: any) {
    expect(DENIED.has(err?.code), `expected a privilege error, got: ${err?.code} ${err?.message}`).toBe(true);
  }
}

describe.skipIf(!enabled)('MySQL grants: append-only audit log (app identity)', () => {
  it('can INSERT and SELECT audit_log', async () => {
    const c = await open(appConn);
    await c.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`,
      ['test:grants', 'probe', 'audit_log', 'grants-test', JSON.stringify({ probe: true })],
    );
    const [rows] = await c.query<any[]>(`SELECT id FROM audit_log WHERE actor = 'test:grants' LIMIT 1`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('is DENIED UPDATE on audit_log', async () => {
    const c = await open(appConn);
    await expectDenied(c.query(`UPDATE audit_log SET action = 'tampered' WHERE actor = 'test:grants'`));
  });

  it('is DENIED DELETE on audit_log', async () => {
    const c = await open(appConn);
    await expectDenied(c.query(`DELETE FROM audit_log WHERE actor = 'test:grants'`));
  });

  it('is DENIED DDL (no DROP/CREATE for the app identity)', async () => {
    const c = await open(appConn);
    await expectDenied(c.query(`CREATE TABLE grants_probe (id INT)`));
  });
});

describe.skipIf(!enabled)('MySQL grants: SELECT-only agent identity', () => {
  it('can SELECT', async () => {
    const c = await open(roConn);
    const [rows] = await c.query<any[]>(`SELECT COUNT(*) AS n FROM audit_log`);
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(0);
  });

  it('is DENIED INSERT — nothing the LLM influences can write', async () => {
    const c = await open(roConn);
    await expectDenied(c.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id) VALUES ('x', 'x', 'x', 'x')`,
    ));
  });

  it('is DENIED UPDATE on investigations', async () => {
    const c = await open(roConn);
    await expectDenied(c.query(`UPDATE investigations SET status = 'completed' WHERE id = 0`));
  });
});
