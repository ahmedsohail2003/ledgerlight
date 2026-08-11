import { describe, expect, it } from 'vitest';
import { validateGrounding, extractNumericTokens } from '../src/agent/grounding.js';
import type { Brief } from '../src/agent/brief-schema.js';
import type { EvidencePack } from '../src/agent/tools.js';

const pack: EvidencePack = {
  vendor: { id: 42, canonical_name: 'EXAMPLE VENDOR' },
  profile: { contract_count: 10, total_value: 19100000, first_award: '2015-03-01', last_award: '2024-02-01', buyer_count: 3 },
  by_buyer: [{ buyer: 'Canada Border Services Agency', contract_count: 6, total_value: 12000000 }],
  top_contracts: [{ contract_id: 7, buyer: 'CBSA', contract_date: '2020-04-01', contract_value: 2350000, description: 'IT services', source_link: null }],
  fired_rules: [{ rule_id: 'repeat_awards_same_pair', severity: 'medium', findings: 2, example_evidence: null }],
  gold_context: [],
  regulations: [{ chunk_id: 'GCR-s6', doc: 'GCR', section_ref: 'section 6', title: 'Exceptions', text: '...', source_url: 'u' }],
  data_coverage_note: 'test coverage note',
};

function brief(overrides: Partial<Brief['claims'][number]>): Brief {
  return {
    target: 'EXAMPLE VENDOR',
    headline: 'h',
    overall_assessment: 'indicators_warrant_review',
    claims: [{ text: 'x', provenance: 'sql_derived', rule_ids: [], figures: [], regulation_citations: [], ...overrides }],
    limitations: 'test',
  };
}

describe('validateGrounding', () => {
  it('accepts a claim whose figure matches the evidence pack exactly', () => {
    const r = validateGrounding(brief({
      text: 'The vendor holds contracts worth $19,100,000 in the loaded data.',
      figures: [{ evidence_ref: 'profile.total_value', value: 19100000 }],
    }), pack);
    expect(r.ok).toBe(true);
  });

  it('rejects a stated number with no declared figure — the hallucination case', () => {
    const r = validateGrounding(brief({
      text: 'The vendor received $60,000,000 for this work.',
      figures: [],
    }), pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('$60,000,000');
    expect(r.reasons[0]).toContain('must be declared');
  });

  it('rejects a declared figure that contradicts the evidence value', () => {
    const r = validateGrounding(brief({
      text: 'Total value is $25,000,000.',
      figures: [{ evidence_ref: 'profile.total_value', value: 25000000 }],
    }), pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('evidence value is 19100000');
  });

  it('rejects a figure whose evidence_ref does not resolve', () => {
    const r = validateGrounding(brief({
      text: 'Value 123 noted.',
      figures: [{ evidence_ref: 'profile.nonexistent_field', value: 123 }],
    }), pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('no numeric value exists at that path');
  });

  it('rejects citing a rule that did not fire', () => {
    const r = validateGrounding(brief({
      text: 'A splitting pattern was detected.',
      provenance: 'rule_derived',
      rule_ids: ['split_awards_under_threshold'],
    }), pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('did NOT fire');
    expect(r.reasons[0]).toContain('repeat_awards_same_pair');
  });

  it('accepts citing a rule that did fire', () => {
    const r = validateGrounding(brief({
      text: 'Repeated awards to the same buyer were flagged.',
      provenance: 'rule_derived',
      rule_ids: ['repeat_awards_same_pair'],
    }), pack);
    expect(r.ok).toBe(true);
  });

  it('accepts a regulation citation that was retrieved for the case', () => {
    const r = validateGrounding(brief({
      text: 'Non-competitive contracting is permitted only under the enumerated exceptions.',
      provenance: 'rule_derived',
      rule_ids: ['repeat_awards_same_pair'],
      regulation_citations: ['GCR-s6'],
    }), pack);
    expect(r.ok).toBe(true);
  });

  it('rejects a regulation citation that was NOT retrieved — the legal-hallucination case', () => {
    const r = validateGrounding(brief({
      text: 'This violates section 12.',
      provenance: 'model_inference',
      regulation_citations: ['GCR-s12'],
    }), pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('GCR-s12');
    expect(r.reasons[0]).toContain('not in the retrieved set');
  });

  it('rejects model_inference claims that smuggle figures or rules', () => {
    const r = validateGrounding(brief({
      text: 'This resembles patterns worth 5 reviews.',
      provenance: 'model_inference',
      figures: [{ evidence_ref: 'profile.buyer_count', value: 3 }],
    }), pack);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('model_inference'))).toBe(true);
  });

  it('allows millions shorthand when the full value is declared', () => {
    const r = validateGrounding(brief({
      text: 'Roughly $19.1 million across the portfolio.',
      figures: [{ evidence_ref: 'profile.total_value', value: 19100000 }],
    }), pack);
    expect(r.ok).toBe(true);
  });

  it('treats standalone years as prose, not figures', () => {
    const r = validateGrounding(brief({
      text: 'Awards ran from 2015 through 2024.',
      figures: [],
    }), pack);
    expect(r.ok).toBe(true);
  });
});

describe('extractNumericTokens', () => {
  it('finds money, counts and percents but skips bare years', () => {
    expect(extractNumericTokens('Paid $1,234,567.89 across 106 contracts since 2011, up 12%'))
      .toEqual(['$1,234,567.89', '106', '12%']);
  });

  it('does not shred ISO dates or year ranges into fake figures', () => {
    expect(extractNumericTokens('Awarded on 2019-09-01 and active 2011-2024.')).toEqual([]);
  });
});

describe('numeric-string evidence values (MySQL DECIMAL round-trip)', () => {
  it('accepts a figure whose evidence value is a numeric string', () => {
    const packStr: EvidencePack = {
      ...pack,
      fired_rules: [{
        rule_id: 'vendor_buyer_concentration', severity: 'medium', findings: 1,
        example_evidence: { vendor_total: '22649438.00' },
      }],
    };
    const r = validateGrounding(brief({
      text: 'Concentration involved $22,649,438 at one buyer.',
      provenance: 'rule_derived',
      rule_ids: ['vendor_buyer_concentration'],
      figures: [{ evidence_ref: 'fired_rules[0].example_evidence.vendor_total', value: 22649438 }],
    }), packStr);
    expect(r.ok).toBe(true);
  });
});

describe('percent rendering of declared fractions', () => {
  it('accepts "56.9%" when the evidence declares 0.569', () => {
    const packWithShare: EvidencePack = {
      ...pack,
      fired_rules: [{
        rule_id: 'vendor_buyer_concentration', severity: 'medium', findings: 1,
        example_evidence: { share: 0.569 },
      }],
    };
    const r = validateGrounding(brief({
      text: 'The vendor held 56.9% of the buyer\'s annual spend.',
      provenance: 'rule_derived',
      rule_ids: ['vendor_buyer_concentration'],
      figures: [{ evidence_ref: 'fired_rules[0].example_evidence.share', value: 0.569 }],
    }), packWithShare);
    expect(r.ok).toBe(true);
  });
});
