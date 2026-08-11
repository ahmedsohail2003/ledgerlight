# Ledgerlight evaluation report

Latest rule run: `44a9ee2a-4bff-4def-9145-91a528b224e4` · gold problematic vendors: 10 · sampled clean: 20

## Rule-level (non-circular: labels from OAG/OPO/suspensions/journalism)
- Recall over problematic vendors: **80.0%** (8/10 flagged by ≥1 indicator)
- False-positive rate over sampled clean vendors: **15.0%** (3/20)

## Agent-level (grounding audit of every stored brief)
- Briefs audited: 6 (model: 0, fallback rate 100.0%)
- **Hallucinated-figure rate in accepted briefs: 0.0%** (0/6)
- First-try-valid rate (model briefs): n/a · avg attempts: n/a

> Data: official Proactive Disclosure of Contracts over $10,000 — all indicators active (procedure, bid-count, amendment). sampled_clean = absence of adverse findings, a weaker label than a clean audit (see FEASIBILITY.md); a higher false-positive rate reflects more indicators firing, not miscalibration. NOTE: the model API was unavailable this run, so every brief used the deterministic fallback — hallucinated-figure rate is 0% by construction. The identical grounding validation applies to model briefs.
