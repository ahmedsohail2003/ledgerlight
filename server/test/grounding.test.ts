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

describe('validator hardening — scale-shorthand gating', () => {
  it('rejects a bare "19.1" with no unit word even though 19,100,000 is declared', () => {
    const r = validateGrounding(brief({
      text: 'The portfolio is roughly 19.1 across the period.',
      figures: [{ evidence_ref: 'profile.total_value', value: 19100000 }],
    }), pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('"19.1"');
  });

  it('rejects a %-token that only matches a declared figure at 1e6 scale', () => {
    const packStr: EvidencePack = {
      ...pack,
      fired_rules: [{
        rule_id: 'vendor_buyer_concentration', severity: 'medium', findings: 1,
        example_evidence: { vendor_total: '22649438.00' },
      }],
    };
    const r = validateGrounding(brief({
      text: 'Concentration reached 22.6% at one buyer.',
      provenance: 'rule_derived',
      rule_ids: ['vendor_buyer_concentration'],
      figures: [{ evidence_ref: 'fired_rules[0].example_evidence.vendor_total', value: 22649438 }],
    }), packStr);
    expect(r.ok).toBe(false);
  });

  it('rejects a bare small count landing in the ×1000 tolerance window of a declared value', () => {
    const packVal: EvidencePack = {
      ...pack,
      top_contracts: [{ contract_id: 7, buyer: 'CBSA', contract_date: '2020-04-01', contract_value: 45100, description: 'IT services', source_link: null }],
    };
    const r = validateGrounding(brief({
      text: 'There were 45 incidents of note.',
      figures: [{ evidence_ref: 'top_contracts[0].contract_value', value: 45100 }],
    }), packVal);
    expect(r.ok).toBe(false);
  });

  it('still accepts "$2.35 million" when 2,350,000 is declared and the unit word is present', () => {
    const r = validateGrounding(brief({
      text: 'The largest award was $2.35 million.',
      figures: [{ evidence_ref: 'top_contracts[0].contract_value', value: 2350000 }],
    }), pack);
    expect(r.ok).toBe(true);
  });
});

describe('validator hardening — headline and limitations', () => {
  it('rejects a hallucinated figure in the headline', () => {
    const b = brief({ text: 'ok', figures: [] });
    b.headline = 'Vendor took $980,000,000 from taxpayers.';
    const r = validateGrounding(b, pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('headline');
  });

  it('accepts a headline figure that matches a declared claim figure', () => {
    const b = brief({
      text: 'Total value is $19,100,000.',
      figures: [{ evidence_ref: 'profile.total_value', value: 19100000 }],
    });
    b.headline = 'Contracts worth $19,100,000 warrant review.';
    expect(validateGrounding(b, pack).ok).toBe(true);
  });

  it('rejects a hallucinated figure in limitations', () => {
    const b = brief({ text: 'ok', figures: [] });
    b.limitations = 'Only 3,500 of the rows were inspected.';
    const r = validateGrounding(b, pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('limitations');
  });

  it('exempts a verbatim quote of the data_coverage_note in limitations', () => {
    const packNote: EvidencePack = {
      ...pack,
      data_coverage_note: 'Data covers contracts over $10,000 only.',
    };
    const b = brief({ text: 'ok', figures: [] });
    b.limitations = `Data covers contracts over $10,000 only. Names are normalized conservatively.`;
    expect(validateGrounding(b, packNote).ok).toBe(true);
  });
});

describe('validator hardening — target laundering and scrub boundaries', () => {
  it('does NOT scrub model-authored target: a figure copied into target still fails the headline scan', () => {
    const b = brief({ text: 'ok', figures: [] });
    b.target = '980,000,000';
    b.headline = 'Vendor took $980,000,000 from taxpayers.';
    const r = validateGrounding(b, pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('headline');
  });

  it('vendor-name scrub is boundary-anchored: a digit-bearing name never eats the middle of a larger number', () => {
    const packNamed: EvidencePack = {
      ...pack,
      vendor: { id: 9, canonical_name: '35' },
    };
    const b = brief({
      text: 'The vendor was paid $1,350,000 across the period.',
      figures: [{ evidence_ref: 'profile.total_value', value: 19100000 }],
    });
    // "35" must NOT be blanked out of "$1,350,000" — the full (wrong) number
    // must surface as an ungrounded token and be rejected intact.
    const r = validateGrounding(b, packNamed);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('$1,350,000');
  });

  it('unit-suffixed numbers ground only at their explicit scale', () => {
    const packRatio: EvidencePack = {
      ...pack,
      fired_rules: [{ rule_id: 'repeat_awards_same_pair', severity: 'medium', findings: 2, example_evidence: { growth_ratio: 3.5 } }],
    };
    const r = validateGrounding(brief({
      text: 'Roughly $3.5 million changed hands.',
      provenance: 'rule_derived',
      rule_ids: ['repeat_awards_same_pair'],
      figures: [{ evidence_ref: 'fired_rules[0].example_evidence.growth_ratio', value: 3.5 }],
    }), packRatio);
    expect(r.ok).toBe(false);
  });

  it('accepts attached single-letter scale suffixes ("19.1M") but not spaced-off ambiguous ones ("5 m")', () => {
    const ok = validateGrounding(brief({
      text: 'Portfolio of $19.1M across the period.',
      figures: [{ evidence_ref: 'profile.total_value', value: 19100000 }],
    }), pack);
    expect(ok.ok).toBe(true);

    const packFive: EvidencePack = {
      ...pack,
      fired_rules: [{ rule_id: 'repeat_awards_same_pair', severity: 'medium', findings: 2, example_evidence: { depth: 5000000 } }],
    };
    const bad = validateGrounding(brief({
      text: 'A trench 5 m deep.',
      provenance: 'rule_derived',
      rule_ids: ['repeat_awards_same_pair'],
      figures: [{ evidence_ref: 'fired_rules[0].example_evidence.depth', value: 5000000 }],
    }), packFive);
    expect(bad.ok).toBe(false);
  });
});

describe('validator hardening — vendor names containing digits', () => {
  it('does not treat digits in the vendor\'s own name as figures', () => {
    const packNamed: EvidencePack = {
      ...pack,
      vendor: { id: 9, canonical_name: 'PEDABUN 35 NURSING PC' },
    };
    const b = brief({
      text: 'PEDABUN 35 NURSING PC holds 10 contracts in the loaded data.',
      figures: [{ evidence_ref: 'profile.contract_count', value: 10 }],
    });
    b.target = 'PEDABUN 35 NURSING PC';
    expect(validateGrounding(b, packNamed).ok).toBe(true);
  });
});

describe('validator hardening — evidence_ref traversal', () => {
  it('rejects grounding a figure to a string .length', () => {
    const r = validateGrounding(brief({
      text: 'Analysis covered 14 dimensions.',
      figures: [{ evidence_ref: 'vendor.canonical_name.length', value: 14 }],
    }), pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('no numeric value exists');
  });

  it('rejects grounding a figure to an array length', () => {
    const r = validateGrounding(brief({
      text: 'There is 1 buyer of note.',
      figures: [{ evidence_ref: 'by_buyer.length', value: 1 }],
    }), pack);
    expect(r.ok).toBe(false);
  });
});

describe('validator hardening — assessment consistency', () => {
  it('rejects no_indicators_found when rules fired', () => {
    const b = brief({ text: 'ok', figures: [] });
    b.overall_assessment = 'no_indicators_found';
    const r = validateGrounding(b, pack);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('no_indicators_found');
  });

  it('rejects indicators_warrant_review when nothing fired', () => {
    const packNone: EvidencePack = { ...pack, fired_rules: [] };
    const b = brief({ text: 'ok', figures: [] });
    b.overall_assessment = 'indicators_warrant_review';
    const r = validateGrounding(b, packNone);
    expect(r.ok).toBe(false);
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
