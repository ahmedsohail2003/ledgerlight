import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Workspace scripts run with cwd=server/, so bare `import 'dotenv/config'`
// would silently miss the repo-root .env the README tells you to create.
// Load the root .env explicitly, then any server/.env; exported vars win over both.
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
dotenv.config();

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  db: {
    host: env('DB_HOST', '127.0.0.1'),
    port: Number(env('DB_PORT', '3306')),
    user: env('DB_USER', 'ledgerlight'),
    password: env('DB_PASSWORD', 'ledgerlight_dev'),
    database: env('DB_NAME', 'ledgerlight'),
  },
  etl: {
    batchSize: Number(env('ETL_BATCH_SIZE', '2000')),
  },
  goldset: {
    candidatesPath: env(
      'GOLDSET_PATH',
      path.join(REPO_ROOT, 'docs/research/gold_set_candidates.json'),
    ),
  },
};
