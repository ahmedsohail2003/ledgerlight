/**
 * Seeds the two demo users. Passwords come from env (SEED_VIEWER_PASSWORD /
 * SEED_ANALYST_PASSWORD) or are generated and printed ONCE — never stored in
 * the repo.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getPool, closePool } from '../db/pool.js';

async function main(): Promise<void> {
  const pool = getPool();
  const users = [
    { email: 'viewer@ledgerlight.local', role: 'viewer', password: process.env.SEED_VIEWER_PASSWORD },
    { email: 'analyst@ledgerlight.local', role: 'analyst', password: process.env.SEED_ANALYST_PASSWORD },
  ];
  for (const u of users) {
    const password = u.password ?? randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role)`,
      [u.email, hash, u.role],
    );
    console.log(`${u.role}: ${u.email}  password: ${password}${u.password ? ' (from env)' : ' (generated — save it now)'}`);
  }
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
