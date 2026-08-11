# Gold-Set Feasibility Report — Verdict: **GO**

> **Update (build):** the official dataset and regulation RAG are integrated.
> The full Proactive Disclosure "Contracts over $10,000" file (~1.29M rows,
> 150k vendors) is loaded, all six indicators are active, and rule-level recall
> over the gold set reached **80%** (vs 40% on bootstrap data). A regulation
> corpus (Government Contracts Regulations SOR/87-402 + curated thresholds,
> 21 chunks) powers RAG-with-citations. See `docs/eval/eval-report.md`.
>
> **Provenance note:** the original research pass was produced by a multi-agent
> sweep (OAG/OPO/journalism/data-structure) in July 2026. After an environment
> reset destroyed the working files, `gold_set_candidates.json` was
> reconstructed from the documented findings; deep links were re-verified where
> possible and index-page URLs are used where a deep link could not be
> re-confirmed. Labels and figures are as originally sourced.

*Sources: Office of the Auditor General (OAG) performance audits, Office of the
Procurement Ombud (OPO) reviews, parliamentary committee reports, PSPC supplier
suspensions/debarments, and investigative journalism — all independent of the
red-flag indicators Ledgerlight itself computes (no circular evaluation). Full
case detail with evidence URLs: `gold_set_candidates.json`.*

## Verdict rationale

The GO bar was: ≥12 problematic cases with medium-or-better match prospects, a
workable negative protocol, and data columns supporting ≥8 indicators. All met:

- **~14 named-vendor problematic cases** with strong independent evidence
  (GC Strategies ×5 case-angles, Dalian, Coradix, McKinsey ×3, Accenture, IBM,
  TEKsystems, CHCA/Pedabun, Global Health Imports, Canada Life), most matching
  real Proactive Disclosure rows at medium-high confidence.
- **7 documented clean cases** (3 program-level OAG positive conclusions + 4
  OPO follow-up reviews) plus a sampling protocol for additional negatives.
- **The official 43-column layout supports 10+ indicators** (solicitation
  procedure codes, number_of_bids, instrument_type C/A amendment rows,
  former_public_servant, indigenous_business, trade agreements).

## The gold set (summary)

| Cluster | Cases | Evidence anchor |
|---|---|---|
| GC Strategies (ArriveCAN + gov-wide + portfolio + parliament + OPO) | 5 | OAG 2024 R1, OAG 2025 R4, OPO epa-ppr-01-2024, suspension→debarment |
| Dalian & Coradix (ArriveCAN JV, Yeo COI, suspensions) | 3 | OAG 2024 R1, OPO review, PSPC suspensions Mar 2024 |
| McKinsey (OAG R5 + OPO + rollup) | 3 | 97 contracts / $209M, 71% non-competitive |
| IBM / Phoenix | 1 | Sole-source $5.7M → ~$185M via amendments (amendment-inflation showcase) |
| TEKsystems (ArriveCAN vehicle) | 1 | OPO review; $23.2M |
| Accenture / CEBA | 1 | OAG 2024 R8 — ⚠ EDC likely outside PD dataset |
| Indigenous set-aside misrepresentation (CHCA/Pedabun; Global Health Imports) | 2 | ISC audits/committee; PSPC ineligibility |
| Canada Life / PSHCP | 1 | OGGO Report 20 |
| Anonymized OPO complaint reviews (IRCC/CRA/ESDC/TC/DFO) | 5 | Corpus/context value; vendors anonymized |
| Alleged (Botler/CBSA; ghost IT invoicing) | 2 | RCMP referrals; label stays `alleged` |
| Clean (vaccines APA, PPE response, Centre Block, 4 OPO follow-ups) | 7 | CLEAN-01 is the hard-negative control: sole-source heuristics fire, label is clean |

## Negative-sampling protocol
Sample contracts that are: competitively awarded (`solicitation_procedure` ∈
{OB, TC}) AND `number_of_bids` ≥ 3 AND vendor absent from every adverse source
above AND normal amendment profile (≤1 amendment, value growth <20%) AND, where
possible, from a buyer+period covered by a positive audit conclusion.
**Limitation (stated wherever metrics appear): absence of adverse findings is
weaker evidence than a clean audit; report documented-clean and sampled-clean
separately.**

## Data plan (implemented)

| Source | Status |
|---|---|
| Proactive Publication — Contracts over $10K (`contracts.csv`, ~600MB, 43 cols, 2004+) | ✅ loaded (`etl:official`; buyer = `owner_org_title`) |
| Government Contracts Regulations SOR/87-402 (19 clauses) + curated thresholds | ✅ loaded (`rag:load`) |
| CanadaBuys award/tender/contract-history CSVs (amendment trails, tender windows) | Future: joins via solicitationNumber |

Key verified gotchas: amendments are separate rows (`instrument_type='A'`,
`contract_value` = new total); `number_of_bids` mandatory only ≥2019 and
`solicitation_procedure` ≥2022; `buyer_name` empty on ~65% of rows (use
`owner_org_title`); vendor-name variance handled by conservative normalization
+ curated aliases (never fuzzy matching).

## Rule-engine implications — active indicators
1. Non-competitive award (TN/AC + limited_tendering_reason)
2. Single-bid "competitive" award (number_of_bids = 1, post-2019)
3. Repeat awards, same vendor+buyer, rolling window
4. Amendment inflation ratio (Phoenix showcase)
5. Threshold-splitting (clusters just under GCR s.6(b) ceilings)
6. Vendor concentration within a buyer

Not reliably supported: losing-bidder identities, evaluation-score details,
pre-2019 bid counts.

## Risks
- **Accenture/CEBA**: EDC is a Crown corporation likely outside the PD dataset — narrative case only.
- **Media-only cases** stay labeled `alleged`, never `problematic`.
- **Vendor-name matching noise** — standardized-name joins + curated alias table.
- **Reconstructed evidence links** — some URLs are official index pages rather than deep links (see provenance note).
