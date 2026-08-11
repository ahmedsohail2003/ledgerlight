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
  findings: number;
}

export async function runRules(pool: Pool, rules: Rule[], runId: string, sources: Set<string>): Promise<RuleRunSummary[]> {
  const summaries: RuleRunSummary[] = [];
  const hasOfficial = sources.has('pd_official');

  for (const rule of rules) {
    if (rule.requires === 'pd_official' && !hasOfficial) {
      summaries.push({ ruleId: rule.id, status: 'dormant', findings: 0 });
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
    await pool.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`,
      ['rules:engine', 'rule_run', 'rule', rule.id,
       JSON.stringify({ runId, findings: rows.length, params: rule.params })],
    );
    summaries.push({ ruleId: rule.id, status: 'ran', findings: rows.length });
  }
  return summaries;
}
