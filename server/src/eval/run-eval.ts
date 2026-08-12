/**
 * Evaluation harness. Produces docs/eval/eval-report.md + eval-results.json.
 *
 *   npm run eval --workspace @ledgerlight/server              # rules + stored-brief audit
 *   npm run eval --workspace @ledgerlight/server -- --with-llm  # also run fresh investigations
 *     over every linked gold vendor + sampled clean vendors (costs API tokens)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, getRoPool, closePool } from '../db/pool.js';
import { computeRuleMetrics, computeAgentMetrics, pct, pctWithCi, type RuleEvalRow, type BriefEvalRow } from './metrics.js';
import { BriefSchema } from '../agent/brief-schema.js';
import { validateGrounding } from '../agent/grounding.js';
import { buildVendorEvidence } from '../agent/tools.js';
import { investigateVendor, persistInvestigation } from '../agent/investigator.js';
import { createGeminiGenerator, hasApiKey } from '../agent/gemini.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLEAN_SAMPLE_SIZE = 20;
const MIN_CONTRACTS_FOR_CLEAN = 10;

async function main(): Promise<void> {
  const withLlm = process.argv.includes('--with-llm');
  const pool = getPool();

  // ---- 1. rule-level eval -------------------------------------------------
  const [goldVendors] = await pool.query<any[]>(
    `SELECT DISTINCT g.vendor_id AS vendorId, v.canonical_name AS name
     FROM gold_labels g JOIN vendors v ON v.id = g.vendor_id
     WHERE g.label = 'problematic' AND g.vendor_id IS NOT NULL`,
  );

  // Hard-negative cohort: gold cases with an independent CLEAN finding that
  // link to real vendors. Reported separately from sampled_clean (FEASIBILITY:
  // "report documented-clean and sampled-clean separately"). May be empty —
  // the report says so honestly rather than pretending the control ran.
  const [documentedClean] = await pool.query<any[]>(
    `SELECT DISTINCT g.vendor_id AS vendorId, v.canonical_name AS name
     FROM gold_labels g JOIN vendors v ON v.id = g.vendor_id
     WHERE g.label = 'clean' AND g.vendor_id IS NOT NULL`,
  );

  // Sampled negatives per the FEASIBILITY negative-sampling protocol:
  //   - active (>= N contracts) and absent from EVERY gold case (any label);
  //   - competitive footprint: >= 3 rows competitively awarded (OB/TC) with
  //     number_of_bids >= 3;
  //   - normal amendment profile: no procurement with more than one amendment
  //     row or >= 20% value growth.
  // (The "positively-audited buyer+period" refinement has no data source yet
  // and is documented as future work.) Deterministic ORDER BY keeps runs
  // reproducible.
  const [cleanVendors] = await pool.query<any[]>(
    `SELECT v.id AS vendorId, v.canonical_name AS name, COUNT(c.id) AS n
     FROM vendors v
     JOIN contracts c ON c.vendor_id = v.id
     WHERE v.id NOT IN (SELECT vendor_id FROM gold_labels WHERE vendor_id IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM contracts a
         WHERE a.vendor_id = v.id AND a.procurement_id IS NOT NULL AND a.original_value > 0
         GROUP BY a.procurement_id
         HAVING COUNT(*) > 2 OR MAX(a.contract_value) / MIN(a.original_value) >= 1.2
       )
     GROUP BY v.id, v.canonical_name
     HAVING COUNT(c.id) >= ?
        AND SUM(CASE WHEN c.solicitation_procedure IN ('OB','TC') AND c.number_of_bids >= 3 THEN 1 ELSE 0 END) >= 3
     ORDER BY MD5(CONCAT(v.id, 'ledgerlight-eval-seed')) LIMIT ?`,
    [MIN_CONTRACTS_FOR_CLEAN, CLEAN_SAMPLE_SIZE],
  );

  // Flags come from rule_vendor_flags — the complete per-vendor aggregate
  // computed without the example-row caps — for the latest COMPLETED run.
  const [latestRun] = await pool.query<any[]>(
    `SELECT run_id FROM rule_runs WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`,
  );
  const runId = latestRun[0]?.run_id ?? null;

  async function firedCount(vendorId: number): Promise<number> {
    if (!runId) return 0;
    const [r] = await pool.query<any[]>(
      `SELECT COUNT(DISTINCT rule_id) AS n FROM rule_vendor_flags WHERE vendor_id = ? AND run_id = ?`,
      [vendorId, runId],
    );
    return Number(r[0].n);
  }

  const ruleRows: RuleEvalRow[] = [];
  for (const v of goldVendors) {
    ruleRows.push({ vendorId: v.vendorId, label: 'problematic', firedRuleCount: await firedCount(v.vendorId) });
  }
  for (const v of cleanVendors) {
    ruleRows.push({ vendorId: v.vendorId, label: 'sampled_clean', firedRuleCount: await firedCount(v.vendorId) });
  }
  for (const v of documentedClean) {
    ruleRows.push({ vendorId: v.vendorId, label: 'documented_clean', firedRuleCount: await firedCount(v.vendorId) });
  }
  const ruleMetrics = computeRuleMetrics(ruleRows);

  // ---- 2. agent-level eval ------------------------------------------------
  if (withLlm) {
    const generator = hasApiKey() ? createGeminiGenerator() : null;
    if (!generator) {
      console.log('(--with-llm requested but no GEMINI_API_KEY; skipping fresh investigations)');
    } else {
      const targets = [...goldVendors, ...cleanVendors.slice(0, 5)];
      for (const t of targets) {
        console.log(`investigating: ${t.name}`);
        const result = await investigateVendor(pool, t.name, generator, getRoPool());
        await persistInvestigation(pool, t.name, result, generator.modelId);
      }
    }
  }

  // Re-validate every stored brief against a freshly built evidence pack: the
  // accepted output itself must still pass grounding — this is the 0% proof.
  const [briefRows] = await pool.query<any[]>(
    `SELECT id, target_ref, mode, attempts, brief FROM investigations WHERE brief IS NOT NULL`,
  );
  const agentRows: BriefEvalRow[] = [];
  for (const row of briefRows) {
    const parsed = BriefSchema.safeParse(typeof row.brief === 'string' ? JSON.parse(row.brief) : row.brief);
    let ok = parsed.success;
    if (parsed.success) {
      // Same SELECT-only identity the agent path uses — the re-audit must not
      // be the one thing quietly running on the write pool.
      const pack = await buildVendorEvidence(getRoPool(), row.target_ref);
      ok = validateGrounding(parsed.data, pack).ok;
    }
    agentRows.push({ investigationId: row.id, mode: row.mode, attempts: row.attempts, groundingOk: ok });
  }
  const agentMetrics = computeAgentMetrics(agentRows);

  // ---- 3. report ----------------------------------------------------------
  const [srcRows] = await pool.query<any[]>('SELECT DISTINCT source FROM contracts');
  const onOfficial = srcRows.some((r) => r.source === 'pd_official');
  const modelUnavailable = agentMetrics.model_briefs === 0 && agentMetrics.briefs_total > 0;

  const caveat = [
    onOfficial
      ? 'Data: official Proactive Disclosure of Contracts over $10,000 — all indicators active (procedure, bid-count, amendment).'
      : 'Bootstrap data: only volume-based indicators active; procedure-based rules dormant.',
    'sampled_clean = absence of adverse findings, a weaker label than a clean audit (see FEASIBILITY.md); a higher false-positive rate reflects more indicators firing, not miscalibration.',
    modelUnavailable
      ? 'NOTE: the model API was unavailable this run, so every brief used the deterministic fallback — hallucinated-figure rate is 0% by construction. The identical grounding validation applies to model briefs.'
      : 'Agent metrics cover live model briefs re-audited against a freshly built evidence pack.',
  ].join(' ');

  const hardNegativeLine = ruleMetrics.documented_clean_total > 0
    ? `- Hard-negative control (documented-clean gold vendors): ${ruleMetrics.documented_clean_flagged}/${ruleMetrics.documented_clean_total} flagged — flags here measure over-accusation risk against independently-audited-clean cases.`
    : '- Hard-negative control: 0 documented-clean gold cases currently link to vendors in the data (the vaccine-APA case is program-level), so this control has NOT been exercised yet.';

  const report = [
    '# Ledgerlight evaluation report',
    '',
    `Latest rule run: \`${runId ?? 'none'}\` · gold problematic vendors: ${ruleMetrics.problematic_total} · sampled clean: ${ruleMetrics.clean_total} · documented clean: ${ruleMetrics.documented_clean_total}`,
    '',
    '## Rule-level (non-circular labels: OAG/OPO/suspensions/journalism)',
    `- Recall over problematic vendors: **${pctWithCi(ruleMetrics.problematic_flagged, ruleMetrics.problematic_total)}**`,
    `- False-positive rate over sampled clean vendors: **${pctWithCi(ruleMetrics.clean_flagged, ruleMetrics.clean_total)}**`,
    hardNegativeLine,
    '',
    'Small-n honesty: with n this size the confidence intervals above are wide —',
    'treat these as screening-level evidence of signal, not calibrated performance',
    'numbers. The problematic cohort is also cluster-correlated (several vendors',
    'share the ArriveCAN scandal), and indicator thresholds were designed against',
    'the same public cases the gold set draws from (labels are independent of the',
    'rules, but this is an in-sample evaluation — there is no held-out set yet).',
    '',
    '## Agent-level (grounding audit of every stored brief)',
    `- Briefs audited: ${agentMetrics.briefs_total} (model: ${agentMetrics.model_briefs}, fallback rate ${pct(agentMetrics.fallback_rate)})`,
    `- **Hallucinated-figure rate in accepted briefs: ${pct(agentMetrics.hallucinated_figure_rate)}** (${agentMetrics.hallucinated_figure_briefs}/${agentMetrics.briefs_total})`,
    `- First-try-valid rate (model briefs): ${pct(agentMetrics.first_try_valid_rate)} · avg attempts: ${agentMetrics.avg_attempts_model?.toFixed(1) ?? 'n/a'}`,
    '',
    `> ${caveat}`,
    '',
  ].join('\n');

  const outDir = path.join(REPO_ROOT, 'docs/eval');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'eval-report.md'), report);
  await writeFile(
    path.join(outDir, 'eval-results.json'),
    JSON.stringify({ runId, ruleMetrics, agentMetrics, ruleRows, agentRows }, null, 1),
  );
  await pool.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, 'eval', 'eval_run', ?, ?)`,
    ['eval:harness', runId ?? 'none', JSON.stringify({ ruleMetrics, agentMetrics })],
  );

  console.log(report);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
