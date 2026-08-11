/**
 * Grounding validator — the structural anti-hallucination layer.
 *
 * A brief is accepted only if:
 *  1. every declared figure's evidence_ref resolves inside the evidence pack
 *     AND the declared value equals the value at that path;
 *  2. every numeric token in claim text matches a declared figure (standalone
 *     years are exempt); a number the model "remembers" from training has no
 *     declaration and is rejected;
 *  3. every rule_id cited actually fired for this target;
 *  4. every regulation citation resolves to a clause actually retrieved for
 *     this case — the same guarantee, extended to the law;
 *  5. model_inference claims carry no figures and no rule_ids — opinions are
 *     allowed, disguised facts are not.
 *
 * Rejections carry the exact reason so the corrective re-prompt can quote it.
 */
import type { Brief } from './brief-schema.js';
import type { EvidencePack } from './tools.js';
import { resolveEvidenceRef } from './tools.js';

export interface GroundingResult {
  ok: boolean;
  reasons: string[];
}

/** Extract numeric tokens from text: "$19,100,000", "19.1", "106", "3.5%". */
export function extractNumericTokens(text: string): string[] {
  // Dates and year ranges are prose, not figures — drop them before matching
  // so "2019-09-01" doesn't shed "09"/"01" fragments.
  const scrubbed = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(19|20)\d{2}\s*[–-]\s*(19|20)?\d{2}\b/g, ' ');
  const matches = scrubbed.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return matches.filter((tok) => {
    const bare = tok.replace(/[$,%]/g, '');
    // Standalone years read naturally in prose and are date context, not figures.
    if (/^(19|20)\d{2}$/.test(bare) && !tok.includes('$') && !tok.includes('%')) return false;
    return true;
  });
}

function tokenToNumber(tok: string): number {
  return Number(tok.replace(/[$,%\s]/g, '').replace(/,/g, ''));
}

function valuesMatch(declared: number, stated: number): boolean {
  if (declared === stated) return true;
  // Accept ≤0.5% relative difference to tolerate display rounding/cents.
  const denom = Math.max(Math.abs(declared), 1e-9);
  return Math.abs(declared - stated) / denom <= 0.005;
}

export function validateGrounding(brief: Brief, pack: EvidencePack): GroundingResult {
  const reasons: string[] = [];
  const firedRuleIds = new Set(pack.fired_rules.map((r) => r.rule_id));
  const retrievedRegIds = new Set((pack.regulations ?? []).map((r) => r.chunk_id));

  brief.claims.forEach((claim, i) => {
    const where = `claims[${i}]`;

    for (const ruleId of claim.rule_ids) {
      if (!firedRuleIds.has(ruleId)) {
        reasons.push(
          `${where} cites rule_id "${ruleId}" which did NOT fire for this target; ` +
          `fired rules are [${[...firedRuleIds].join(', ') || 'none'}]. Cite only fired rules or drop the claim.`,
        );
      }
    }

    // A regulation citation must resolve to a clause actually retrieved for
    // this investigation — the anti-hallucination guarantee for the law, too.
    for (const regId of claim.regulation_citations) {
      if (!retrievedRegIds.has(regId)) {
        reasons.push(
          `${where} cites regulation "${regId}" which was not in the retrieved set ` +
          `[${[...retrievedRegIds].join(', ') || 'none'}]. Cite only a retrieved chunk_id or drop it.`,
        );
      }
    }

    const declaredValues: number[] = [];
    for (const fig of claim.figures) {
      let found = resolveEvidenceRef(pack, fig.evidence_ref);
      // MySQL DECIMALs round-trip as strings ("22649438.00"); coerce clean
      // numeric strings so real evidence values are citable.
      if (typeof found === 'string' && found.trim() !== '' && Number.isFinite(Number(found))) {
        found = Number(found);
      }
      if (typeof found !== 'number') {
        reasons.push(
          `${where} declares figure ref "${fig.evidence_ref}" but no numeric value exists at that path in the evidence pack.`,
        );
        continue;
      }
      if (!valuesMatch(found, fig.value)) {
        reasons.push(
          `${where} declares value ${fig.value} for "${fig.evidence_ref}" but the evidence value is ${found}. Use only source values.`,
        );
        continue;
      }
      declaredValues.push(fig.value);
    }

    for (const tok of extractNumericTokens(claim.text)) {
      const stated = tokenToNumber(tok);
      const covered = declaredValues.some((v) => valuesMatch(v, stated))
        // Millions shorthand: "19.1" against declared 19100000.
        || declaredValues.some((v) => valuesMatch(v, stated * 1_000_000))
        || declaredValues.some((v) => valuesMatch(v, stated * 1_000))
        // Percent rendering of a declared fraction: "56.9%" against 0.569.
        || (tok.endsWith('%') && declaredValues.some((v) => valuesMatch(v, stated / 100)));
      if (!covered) {
        reasons.push(
          `${where} states the number "${tok}" but no declared figure matches it. ` +
          `Every number must be declared in figures[] with its evidence_ref, or removed.`,
        );
      }
    }

    if (claim.provenance === 'model_inference' && (claim.figures.length > 0 || claim.rule_ids.length > 0)) {
      reasons.push(
        `${where} is provenance=model_inference but carries figures/rule_ids; ` +
        `re-tag it as sql_derived/rule_derived with proper refs, or strip the figures.`,
      );
    }
    if (claim.provenance === 'rule_derived' && claim.rule_ids.length === 0) {
      reasons.push(`${where} is provenance=rule_derived but cites no rule_ids.`);
    }
  });

  return { ok: reasons.length === 0, reasons };
}
