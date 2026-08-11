import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/agent/investigator.js';
import { buildFallbackBrief } from '../src/agent/fallback.js';
import { validateGrounding } from '../src/agent/grounding.js';
import { BriefSchema } from '../src/agent/brief-schema.js';
import type { EvidencePack } from '../src/agent/tools.js';

const pack: EvidencePack = {
  vendor: { id: 1, canonical_name: 'TEST CO' },
  profile: { contract_count: 4, total_value: 500000, first_award: '2020-01-01', last_award: '2023-01-01', buyer_count: 2 },
  by_buyer: [],
  top_contracts: [],
  fired_rules: [{ rule_id: 'repeat_awards_same_pair', severity: 'medium', findings: 1, example_evidence: null }],
  gold_context: [],
  regulations: [],
  data_coverage_note: 'note',
};

describe('buildPrompt', () => {
  it('embeds the evidence pack and hard rules', () => {
    const p = buildPrompt('TEST CO', pack);
    expect(p).toContain('EVIDENCE PACK');
    expect(p).toContain('repeat_awards_same_pair');
    expect(p).toContain('indicators warranting review');
  });

  it('quotes the exact rejection reasons back on retry', () => {
    const p = buildPrompt('TEST CO', pack, ['claims[0] states the number "42" but no declared figure matches it.']);
    expect(p).toContain('REJECTED');
    expect(p).toContain('the number "42"');
  });
});

describe('fallback brief', () => {
  it('is schema-valid and grounding-valid by construction', () => {
    const b = buildFallbackBrief('TEST CO', pack);
    expect(BriefSchema.safeParse(b).success).toBe(true);
    expect(validateGrounding(b, pack).ok).toBe(true);
    expect(b.overall_assessment).toBe('indicators_warrant_review');
  });

  it('degrades honestly when the vendor is unknown', () => {
    const empty: EvidencePack = { ...pack, vendor: null, profile: null, fired_rules: [] };
    const b = buildFallbackBrief('NOBODY INC', empty);
    expect(b.overall_assessment).toBe('insufficient_data');
    expect(validateGrounding(b, empty).ok).toBe(true);
  });
});
