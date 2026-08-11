import mysql from 'mysql2/promise';
import { config } from '../config.js';

let pool: mysql.Pool | undefined;
let roPool: mysql.Pool | undefined;
let adminPool: mysql.Pool | undefined;

const POOL_OPTS = {
  waitForConnections: true,
  connectionLimit: 8,
  namedPlaceholders: true,
  supportBigNumbers: true,
  // DECIMAL as number, not string — contract values are well inside the
  // safe-integer range and evidence packs must be numerically citable.
  decimalNumbers: true,
} as const;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({ ...config.db, ...POOL_OPTS });
  }
  return pool;
}

/**
 * SELECT-only connection for everything the LLM agent can influence
 * (evidence assembly). Backed by a MySQL user with no write grants — even a
 * fully hijacked prompt cannot mutate state through this pool. Falls back to
 * the main pool when DB_RO_USER is unset (documented gap for bare setups).
 */
export function getRoPool(): mysql.Pool {
  const roUser = process.env.DB_RO_USER;
  if (!roUser) return getPool();
  if (!roPool) {
    roPool = mysql.createPool({
      ...config.db,
      user: roUser,
      password: process.env.DB_RO_PASSWORD ?? '',
      ...POOL_OPTS,
    });
  }
  return roPool;
}

/** Admin connection for maintenance operations that need DDL (e.g. TRUNCATE in
 *  the official ETL reset). Never used by the request path. Falls back to the
 *  main pool when DB_ADMIN_USER is unset. */
export function getAdminPool(): mysql.Pool {
  const adminUser = process.env.DB_ADMIN_USER;
  if (!adminUser) return getPool();
  if (!adminPool) {
    adminPool = mysql.createPool({
      ...config.db,
      user: adminUser,
      password: process.env.DB_ADMIN_PASSWORD ?? '',
      ...POOL_OPTS,
    });
  }
  return adminPool;
}

export async function closePool(): Promise<void> {
  for (const p of [pool, roPool, adminPool]) {
    if (p) await p.end();
  }
  pool = undefined;
  roPool = undefined;
  adminPool = undefined;
}
