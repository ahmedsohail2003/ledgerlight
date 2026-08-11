import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getAdminPool, closePool } from './pool.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function main(): Promise<void> {
  // Migrations are DDL — run on the admin identity (the app user has no DDL
  // grants by design; see server/src/db/grants.sql).
  const pool = getAdminPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const [appliedRows] = await pool.query<any[]>('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file}`);
      continue;
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Naive splitter is fine here: our migrations avoid semicolons in strings.
    const statements = sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
    await pool.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
    console.log(`apply ${file} (${statements.length} statements)`);
  }
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
