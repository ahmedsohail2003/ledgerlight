import { randomUUID } from 'node:crypto';
import { getPool, closePool } from '../db/pool.js';
import { runRules } from './engine.js';
import { RULES } from './indicators/index.js';

async function main(): Promise<void> {
  const pool = getPool();
  const runId = randomUUID();

  const [srcRows] = await pool.query<any[]>('SELECT DISTINCT source FROM contracts');
  const sources = new Set<string>(srcRows.map((r) => r.source));
  console.log(`run ${runId} over sources: ${[...sources].join(', ') || '(none)'}`);

  const summaries = await runRules(pool, RULES, runId, sources);
  for (const s of summaries) {
    console.log(`  ${s.status === 'dormant' ? 'DORMANT' : 'RAN'}  ${s.ruleId}: ${s.status === 'dormant' ? 'needs pd_official columns' : s.findings + ' findings'}`);
  }

  // Cross-reference: which gold-set vendors were flagged by any rule this run?
  const [xref] = await pool.query<any[]>(
    `SELECT g.case_id, g.label, v.canonical_name AS vendor,
            COUNT(DISTINCT r.rule_id) AS rules_fired, COUNT(r.id) AS findings
     FROM gold_labels g
     JOIN vendors v ON v.id = g.vendor_id
     LEFT JOIN rule_results r ON r.vendor_id = g.vendor_id AND r.run_id = ?
     GROUP BY g.case_id, g.label, v.canonical_name
     ORDER BY findings DESC`,
    [runId],
  );
  console.log('\ngold-set cross-reference (rules fired per labeled vendor):');
  for (const row of xref) {
    console.log(`  [${row.label}] ${row.case_id} (${row.vendor}): ${row.rules_fired} rules, ${row.findings} findings`);
  }
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
