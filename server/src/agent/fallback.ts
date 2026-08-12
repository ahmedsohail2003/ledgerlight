/**
 * Deterministic fallback brief: assembled purely from the evidence pack with
 * zero free-form generation. Guarantees the tool always returns a defensible
 * output even when the model fails validation repeatedly, errors, or no key
 * is set.
 */
import type { Brief, Claim } from './brief-schema.js';
import type { EvidencePack } from './tools.js';

export function buildFallbackBrief(target: string, pack: EvidencePack): Brief {
  const claims: Claim[] = [];

  if (!pack.vendor || !pack.profile) {
    return {
      target,
      // Static text: the raw target string is user/model-supplied and may
      // contain digits, which the grounding re-audit would flag as
      // undeclared figures if interpolated here.
      headline: 'No contract records found for this target in the loaded data.',
      overall_assessment: 'insufficient_data',
      claims: [{
        text: 'The target could not be resolved to any vendor in the loaded contract data.',
        provenance: 'sql_derived',
        rule_ids: [],
        figures: [],
        regulation_citations: [],
      }],
      limitations: pack.data_coverage_note,
    };
  }

  claims.push({
    text: `${pack.vendor.canonical_name} holds ${pack.profile.contract_count} contracts worth ${pack.profile.total_value} in the loaded data, across ${pack.profile.buyer_count} buying organizations.`,
    provenance: 'sql_derived',
    rule_ids: [],
    figures: [
      { evidence_ref: 'profile.contract_count', value: pack.profile.contract_count },
      { evidence_ref: 'profile.total_value', value: pack.profile.total_value },
      { evidence_ref: 'profile.buyer_count', value: pack.profile.buyer_count },
    ],
    regulation_citations: [],
  });

  const retrievedRegIds = new Set(pack.regulations.map((r) => r.chunk_id));
  pack.fired_rules.forEach((r, i) => {
    // Cite the top retrieved clause when it's clearly on point (sole-source).
    const cite = r.rule_id === 'noncompetitive_award' && retrievedRegIds.has('GCR-s6') ? ['GCR-s6'] : [];
    claims.push({
      text: `Deterministic indicator "${r.rule_id}" (severity ${r.severity}) produced ${r.findings} finding(s) for this vendor. This is an indicator warranting review, not a conclusion of wrongdoing.`,
      provenance: 'rule_derived',
      rule_ids: [r.rule_id],
      figures: [{ evidence_ref: `fired_rules[${i}].findings`, value: r.findings }],
      regulation_citations: cite,
    });
  });

  return {
    target,
    // Digit-free by design: the grounding validator scans headlines for
    // numeric tokens, and the rule count is already declared claim-by-claim.
    headline: pack.fired_rules.length > 0
      ? `${pack.vendor.canonical_name}: deterministic indicators warrant review.`
      : `${pack.vendor.canonical_name}: no deterministic indicators fired on the loaded data.`,
    overall_assessment: pack.fired_rules.length > 0 ? 'indicators_warrant_review' : 'no_indicators_found',
    claims,
    limitations: pack.data_coverage_note,
  };
}
