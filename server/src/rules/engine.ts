/**
 * Deterministic red-flag rule engine. Each rule is a parameterized SQL query
 * whose rows become rule_results with structured evidence. Rules are
 * indicators warranting review — never accusations; that framing is enforced
 * in the UI and docs, and every result carries the SQL evidence it came from.
 *
 * Rules with `requires: 'pd_official'` need columns only present in the
 * official Proactive Disclosure dataset (solicitation_procedure,
 * number_of_bids, instrument_type amendments) and stay dormant on bootstrap
 * data — dormancy is reported, not silently skipped.
 */
import type { Pool } from 'mysql2/promise';

export type Severity = 'info' | 'low' | 'medium' | 'high';

export interface Rule {
  id: string;
  title: string;
  ocpReference: string;
  severity: Severity;
  requires: 'any' | 'pd_official';
  description: string;
  sql: string;
  params: Record<string, unknown>;
}

export interface RuleRunSummary {
  ruleId: string;
  status: 'ran' | 'dormant';
  /** True total findings across ALL qualifying rows (uncapped). */
  findings: number;
  /** Example rows stored in rule_results (bounded by the rule's LIMIT). */
  examples: number;
}

/** The trailing LIMIT bounds stored example rows only; the flag table is
 *  computed over the full result set with this cap stripped. */
function withoutTrailingLimit(sql: string): string {
  return sql.replace(/\bLIMIT\s+\d+\s*$/i, '');
}

export async function runRules(pool: Pool, rules: Rule[], runId: string, sources: Set<string>): Promise<RuleRunSummary[]> {
  const summaries: RuleRunSummary[] = [];
  const hasOfficial = sources.has('pd_official');

  // Register the run; consumers only trust runs with completed_at set, so a
  // half-finished (or crashed) run can never serve partial flag sets.
  await pool.query(`INSERT INTO rule_runs (run_id) VALUES (?)`, [runId]);

  for (const rule of rules) {
    if (rule.requires === 'pd_official' && !hasOfficial) {
      summaries.push({ ruleId: rule.id, status: 'dormant', findings: 0, examples: 0 });
      continue;
    }
    // mysql2's QueryValues typing predates named-placeholder objects; runtime supports them.
    const [rows] = await pool.query<any[]>({ sql: rule.sql, values: rule.params as any, namedPlaceholders: true });
    for (const row of rows) {
      await pool.query(
        `INSERT INTO rule_results (run_id, rule_id, severity, vendor_id, buyer_id, contract_id, evidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [runId, rule.id, rule.severity,
         row.vendor_id ?? null, row.buyer_id ?? null, row.contract_id ?? null,
         JSON.stringify(row)],
      );
    }

    // Complete per-vendor flags, uncapped: whether a vendor is "flagged" (and
    // its finding count) must never depend on which rows fit under the
    // example cap. Eval metrics and evidence packs read THIS table.
    const [flagRows] = await pool.query<any[]>({
      sql: `SELECT sub.vendor_id, COUNT(*) AS finding_count
            FROM (${withoutTrailingLimit(rule.sql)}) AS sub
            WHERE sub.vendor_id IS NOT NULL
            GROUP BY sub.vendor_id`,
      values: rule.params as any,
      namedPlaceholders: true,
    });
    if (flagRows.length > 0) {
      const BATCH = 2000;
      for (let i = 0; i < flagRows.length; i += BATCH) {
        const chunk = flagRows.slice(i, i + BATCH).map((r) => [runId, rule.id, rule.severity, r.vendor_id, Number(r.finding_count)]);
        await pool.query(
          `INSERT INTO rule_vendor_flags (run_id, rule_id, severity, vendor_id, finding_count) VALUES ?`,
          [chunk],
        );
      }
    }

    const [totals] = await pool.query<any[]>(
      `SELECT COUNT(*) AS vendors, COALESCE(SUM(finding_count), 0) AS findings
       FROM rule_vendor_flags WHERE run_id = ? AND rule_id = ?`,
      [runId, rule.id],
    );
    const totalFindings = Number(totals[0].findings);

    await pool.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`,
      ['rules:engine', 'rule_run', 'rule', rule.id,
       JSON.stringify({ runId, findings: totalFindings, examples: rows.length, flaggedVendors: Number(totals[0].vendors), params: rule.params })],
    );
    summaries.push({ ruleId: rule.id, status: 'ran', findings: totalFindings, examples: rows.length });
  }

  await pool.query(`UPDATE rule_runs SET completed_at = CURRENT_TIMESTAMP WHERE run_id = ?`, [runId]);
  return summaries;
}

/** The run consumers should read: the most recently COMPLETED one. */
export async function latestCompletedRunId(pool: Pool): Promise<string | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT run_id FROM rule_runs WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`,
  );
  return rows[0]?.run_id ?? null;
}
