/**
 * Grounding validator — the structural anti-hallucination layer.
 *
 * A brief is accepted only if:
 *  1. every declared figure's evidence_ref resolves inside the evidence pack
 *     (own data properties only — no prototype walks, no .length tricks)
 *     AND the declared value equals the value at that path;
 *  2. every numeric token in claim text matches a declared figure (standalone
 *     years are exempt; digits that are part of the vendor's own name are
 *     exempt); a number the model "remembers" from training has no
 *     declaration and is rejected. Scale shorthand ("19.1 million") is
 *     accepted ONLY when the unit word is present — a bare token never
 *     matches a declared figure at 1000× or 1000000× its value;
 *  3. the same numeric-token rule applies to the headline and limitations,
 *     checked against the union of declared figures (verbatim quotes of the
 *     pack's data_coverage_note are exempt in limitations — that text IS
 *     evidence);
 *  4. every rule_id cited actually fired for this target, and the
 *     overall_assessment cannot contradict the fired-rule set;
 *  5. every regulation citation resolves to a clause actually retrieved for
 *     this case — the same guarantee, extended to the law;
 *  6. model_inference claims carry no figures and no rule_ids — opinions are
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

interface NumericToken {
  tok: string;
  /** Multiplier implied by an adjacent unit word ("million", "k") — 1 when absent. */
  unitMultiplier: number;
  isPercent: boolean;
}

const TOKEN_RE = /\$?\d[\d,]*(?:\.\d+)?%?/g;

function scrubProse(text: string): string {
  // Dates and year ranges are prose, not figures — drop them before matching
  // so "2019-09-01" doesn't shed "09"/"01" fragments.
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(19|20)\d{2}\s*[–-]\s*(19|20)?\d{2}\b/g, ' ');
}

function unitMultiplierAfter(text: string, tokenEnd: number): number {
  const rest = text.slice(tokenEnd, tokenEnd + 12);
  if (/^\s{0,2}(million|mn|m)\b/i.test(rest)) return 1_000_000;
  if (/^\s{0,2}(billion|bn)\b/i.test(rest)) return 1_000_000_000;
  if (/^\s{0,2}(thousand|k)\b/i.test(rest)) return 1_000;
  return 1;
}

function tokenize(text: string): NumericToken[] {
  const scrubbed = scrubProse(text);
  const out: NumericToken[] = [];
  for (const m of scrubbed.matchAll(TOKEN_RE)) {
    const tok = m[0];
    const bare = tok.replace(/[$,%]/g, '');
    // Standalone years read naturally in prose and are date context, not figures.
    if (/^(19|20)\d{2}$/.test(bare) && !tok.includes('$') && !tok.includes('%')) continue;
    out.push({
      tok,
      unitMultiplier: unitMultiplierAfter(scrubbed, (m.index ?? 0) + tok.length),
      isPercent: tok.endsWith('%'),
    });
  }
  return out;
}

/** Extract numeric tokens from text: "$19,100,000", "19.1", "106", "3.5%". */
export function extractNumericTokens(text: string): string[] {
  return tokenize(text).map((t) => t.tok);
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

function tokenCovered(t: NumericToken, declaredValues: number[]): boolean {
  const stated = tokenToNumber(t.tok);
  return declaredValues.some((v) => {
    if (valuesMatch(v, stated)) return true;
    // Percent rendering of a declared fraction: "56.9%" against 0.569.
    // A %-token never scale-matches — "22.6%" must not pass via 22,600,000.
    if (t.isPercent) return valuesMatch(v, stated / 100);
    // Unit shorthand only when the unit word is actually present in the text.
    if (t.unitMultiplier !== 1) return valuesMatch(v, stated * t.unitMultiplier);
    return false;
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Digits inside the vendor's own name ("PEDABUN 35 NURSING") are identity,
 *  not figures — blank the name out before token extraction. */
function scrubVendorName(text: string, brief: Brief, pack: EvidencePack): string {
  let out = text;
  const names = new Set<string>();
  if (pack.vendor?.canonical_name) names.add(pack.vendor.canonical_name);
  if (brief.target) names.add(brief.target);
  for (const name of names) {
    if (!/\d/.test(name)) continue; // only names that would shed tokens
    out = out.replace(new RegExp(escapeRegExp(name), 'gi'), ' ');
  }
  return out;
}

export function validateGrounding(brief: Brief, pack: EvidencePack): GroundingResult {
  const reasons: string[] = [];
  const firedRuleIds = new Set(pack.fired_rules.map((r) => r.rule_id));
  const retrievedRegIds = new Set((pack.regulations ?? []).map((r) => r.chunk_id));
  const allDeclaredValues: number[] = [];

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
      allDeclaredValues.push(fig.value);
    }

    for (const t of tokenize(scrubVendorName(claim.text, brief, pack))) {
      if (!tokenCovered(t, declaredValues)) {
        reasons.push(
          `${where} states the number "${t.tok}" but no declared figure matches it. ` +
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

  // The headline is the most prominent surface of the brief — it gets the
  // same numeric discipline, checked against the union of declared figures.
  for (const t of tokenize(scrubVendorName(brief.headline, brief, pack))) {
    if (!tokenCovered(t, allDeclaredValues)) {
      reasons.push(
        `headline states the number "${t.tok}" but no claim declares a matching figure. ` +
        `Declare it in a claim's figures[] or remove it from the headline.`,
      );
    }
  }

  // Limitations too — but a verbatim quote of the pack's data_coverage_note
  // is evidence text and exempt.
  let limitations = brief.limitations;
  if (pack.data_coverage_note) {
    limitations = limitations.split(pack.data_coverage_note).join(' ');
  }
  for (const t of tokenize(scrubVendorName(limitations, brief, pack))) {
    if (!tokenCovered(t, allDeclaredValues)) {
      reasons.push(
        `limitations states the number "${t.tok}" but no claim declares a matching figure. ` +
        `Quote the data_coverage_note verbatim, declare the figure, or remove it.`,
      );
    }
  }

  // The verdict may not contradict the deterministic evidence.
  if (brief.overall_assessment === 'indicators_warrant_review' && firedRuleIds.size === 0) {
    reasons.push(
      'overall_assessment is "indicators_warrant_review" but no deterministic indicators fired; ' +
      'use "no_indicators_found" (or "insufficient_data" if the target did not resolve).',
    );
  }
  if (brief.overall_assessment === 'no_indicators_found' && firedRuleIds.size > 0) {
    reasons.push(
      `overall_assessment is "no_indicators_found" but ${firedRuleIds.size} indicator(s) fired ` +
      `[${[...firedRuleIds].join(', ')}]; use "indicators_warrant_review".`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}
