import { describe, expect, it } from 'vitest';
import { computeRuleMetrics, computeAgentMetrics, wilson95, pctWithCi, type RuleEvalRow } from '../src/eval/metrics.js';

describe('computeRuleMetrics', () => {
  const rows: RuleEvalRow[] = [
    { vendorId: 1, label: 'problematic', firedRuleCount: 2 },
    { vendorId: 2, label: 'problematic', firedRuleCount: 0 },
    { vendorId: 3, label: 'sampled_clean', firedRuleCount: 0 },
    { vendorId: 4, label: 'sampled_clean', firedRuleCount: 1 },
    { vendorId: 5, label: 'documented_clean', firedRuleCount: 1 },
  ];

  it('computes recall and FPR from the correct cohorts', () => {
    const m = computeRuleMetrics(rows);
    expect(m.problematic_total).toBe(2);
    expect(m.problematic_flagged).toBe(1);
    expect(m.recall).toBe(0.5);
    expect(m.clean_total).toBe(2);
    expect(m.clean_flagged).toBe(1);
    expect(m.false_positive_rate).toBe(0.5);
  });

  it('reports the documented-clean hard-negative cohort separately', () => {
    const m = computeRuleMetrics(rows);
    expect(m.documented_clean_total).toBe(1);
    expect(m.documented_clean_flagged).toBe(1);
    // and it must not leak into the sampled-clean FPR
    expect(m.clean_total).toBe(2);
  });

  it('returns null rates on empty cohorts instead of dividing by zero', () => {
    const m = computeRuleMetrics([]);
    expect(m.recall).toBeNull();
    expect(m.false_positive_rate).toBeNull();
  });
});

describe('wilson95', () => {
  it('matches the known interval for 8/10', () => {
    const ci = wilson95(8, 10)!;
    expect(ci.lo).toBeCloseTo(0.49, 2);
    expect(ci.hi).toBeCloseTo(0.943, 2);
  });

  it('stays inside [0, 1] at the extremes', () => {
    const zero = wilson95(0, 5)!;
    const all = wilson95(5, 5)!;
    expect(zero.lo).toBe(0);
    expect(all.hi).toBe(1);
    expect(zero.hi).toBeGreaterThan(0);
    expect(all.lo).toBeLessThan(1);
  });

  it('returns null when n = 0', () => {
    expect(wilson95(0, 0)).toBeNull();
  });
});

describe('pctWithCi', () => {
  it('renders the rate with raw counts and the interval', () => {
    const s = pctWithCi(8, 10);
    expect(s).toContain('80.0%');
    expect(s).toContain('(8/10');
    expect(s).toContain('95% CI');
  });
});

describe('computeAgentMetrics', () => {
  it('separates model and fallback briefs and counts grounding failures', () => {
    const m = computeAgentMetrics([
      { investigationId: 1, mode: 'model', attempts: 1, groundingOk: true },
      { investigationId: 2, mode: 'model', attempts: 3, groundingOk: true },
      { investigationId: 3, mode: 'fallback', attempts: 0, groundingOk: false },
    ]);
    expect(m.briefs_total).toBe(3);
    expect(m.model_briefs).toBe(2);
    expect(m.first_try_valid).toBe(1);
    expect(m.avg_attempts_model).toBe(2);
    expect(m.hallucinated_figure_briefs).toBe(1);
  });
});
