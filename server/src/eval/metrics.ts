/**
 * Evaluation metric computations, pure and unit-testable.
 *
 * Two layers:
 * 1. RULE-LEVEL: do the deterministic indicators separate independently-labeled
 *    problematic vendors from sampled-clean vendors? (recall / false-positive
 *    rate). Labels come from OAG/OPO/suspensions/journalism — never from the
 *    rules themselves, so this is non-circular.
 * 2. AGENT-LEVEL: re-validate every accepted brief with the grounding
 *    validator. hallucinated_figure_rate is the share of accepted briefs
 *    containing any claim that fails grounding — the architecture makes this
 *    0% by construction, and this metric PROVES it rather than asserts it.
 */

export interface RuleEvalRow {
  vendorId: number;
  /** documented_clean = gold cases with an independent CLEAN finding (the
   *  hard-negative cohort), reported separately from sampled_clean per the
   *  FEASIBILITY protocol. */
  label: 'problematic' | 'sampled_clean' | 'documented_clean';
  firedRuleCount: number;
}

export interface RuleEvalMetrics {
  problematic_total: number;
  problematic_flagged: number;
  recall: number | null;
  clean_total: number;
  clean_flagged: number;
  false_positive_rate: number | null;
  documented_clean_total: number;
  documented_clean_flagged: number;
}

export function computeRuleMetrics(rows: RuleEvalRow[]): RuleEvalMetrics {
  const problem = rows.filter((r) => r.label === 'problematic');
  const clean = rows.filter((r) => r.label === 'sampled_clean');
  const docClean = rows.filter((r) => r.label === 'documented_clean');
  const problemFlagged = problem.filter((r) => r.firedRuleCount > 0).length;
  const cleanFlagged = clean.filter((r) => r.firedRuleCount > 0).length;
  return {
    problematic_total: problem.length,
    problematic_flagged: problemFlagged,
    recall: problem.length ? problemFlagged / problem.length : null,
    clean_total: clean.length,
    clean_flagged: cleanFlagged,
    false_positive_rate: clean.length ? cleanFlagged / clean.length : null,
    documented_clean_total: docClean.length,
    documented_clean_flagged: docClean.filter((r) => r.firedRuleCount > 0).length,
  };
}

/** Wilson 95% score interval — the honest companion to any small-n rate.
 *  Returns null when n = 0. */
export function wilson95(successes: number, n: number): { lo: number; hi: number } | null {
  if (n === 0) return null;
  const z = 1.959963984540054;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, (centre - margin) / denom), hi: Math.min(1, (centre + margin) / denom) };
}

/** Render a rate with its raw counts and Wilson 95% CI: "80.0% (8/10, 95% CI 49.0–94.3%)". */
export function pctWithCi(successes: number, n: number): string {
  if (n === 0) return 'n/a';
  const ci = wilson95(successes, n)!;
  return `${((successes / n) * 100).toFixed(1)}% (${successes}/${n}, 95% CI ${(ci.lo * 100).toFixed(1)}–${(ci.hi * 100).toFixed(1)}%)`;
}

export interface BriefEvalRow {
  investigationId: number;
  mode: 'model' | 'fallback';
  attempts: number;
  groundingOk: boolean;
}

export interface AgentEvalMetrics {
  briefs_total: number;
  model_briefs: number;
  fallback_rate: number | null;
  first_try_valid: number;
  first_try_valid_rate: number | null;
  avg_attempts_model: number | null;
  hallucinated_figure_briefs: number;
  hallucinated_figure_rate: number | null;
}

export function computeAgentMetrics(rows: BriefEvalRow[]): AgentEvalMetrics {
  const model = rows.filter((r) => r.mode === 'model');
  const firstTry = model.filter((r) => r.attempts === 1).length;
  const bad = rows.filter((r) => !r.groundingOk).length;
  return {
    briefs_total: rows.length,
    model_briefs: model.length,
    fallback_rate: rows.length ? (rows.length - model.length) / rows.length : null,
    first_try_valid: firstTry,
    first_try_valid_rate: model.length ? firstTry / model.length : null,
    avg_attempts_model: model.length ? model.reduce((s, r) => s + r.attempts, 0) / model.length : null,
    hallucinated_figure_briefs: bad,
    hallucinated_figure_rate: rows.length ? bad / rows.length : null,
  };
}

export function pct(v: number | null): string {
  return v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
}
