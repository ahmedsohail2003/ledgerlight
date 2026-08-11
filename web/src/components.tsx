import type { Claim, RegulationChunk } from './api';

export const PROVENANCE_META = {
  rule_derived: { cls: 'rule', label: 'Rule' },
  sql_derived: { cls: 'data', label: 'Data' },
  model_inference: { cls: 'model', label: 'Model inference' },
} as const;

export function ProvenanceChip({ p }: { p: Claim['provenance'] }) {
  const m = PROVENANCE_META[p];
  return (
    <span className={`chip ${m.cls}`}>
      <span className="dot" aria-hidden />
      {m.label}
    </span>
  );
}

export function ProvenanceLegend() {
  return (
    <div className="legend">
      <ProvenanceChip p="rule_derived" />
      <ProvenanceChip p="sql_derived" />
      <ProvenanceChip p="model_inference" />
      <span className="sub">— every sentence is tagged with where it came from</span>
    </div>
  );
}

export function ClaimRow({ claim, regs }: { claim: Claim; regs?: Record<string, RegulationChunk> }) {
  const m = PROVENANCE_META[claim.provenance];
  const hasRefs = claim.rule_ids.length > 0 || claim.figures.length > 0 || claim.regulation_citations.length > 0;
  return (
    <div className={`claim ${m.cls}`}>
      <ProvenanceChip p={claim.provenance} /> <span>{claim.text}</span>
      {hasRefs && (
        <div className="refs">
          {claim.rule_ids.map((r) => <span className="ref" key={`r-${r}`}>rule:{r}</span>)}
          {claim.regulation_citations.map((cid) => {
            const reg = regs?.[cid];
            return reg
              ? <a className="ref law" key={`l-${cid}`} href={reg.source_url} target="_blank" rel="noreferrer" title={`${reg.doc} — ${reg.title}`}>⚖ {reg.section_ref}</a>
              : <span className="ref law" key={`l-${cid}`}>law:{cid}</span>;
          })}
          {claim.figures.map((f, i) => (
            <span className="ref" key={`f-${i}`}>{f.evidence_ref} = {f.value.toLocaleString('en-CA')}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

export function AssessmentBadge({ a }: { a: string }) {
  if (a === 'indicators_warrant_review') return <span className="assessment review">Indicators warrant review</span>;
  if (a === 'no_indicators_found') return <span className="assessment none">No indicators found</span>;
  return <span className="assessment insufficient">Insufficient data</span>;
}
