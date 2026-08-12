# Ledgerlight evaluation report

Latest rule run: `da4a2467-dc33-4a70-9ae2-edad87d5beac` · gold problematic vendors: 9 · sampled clean: 20 · documented clean: 0

## Rule-level (non-circular labels: OAG/OPO/suspensions/journalism)
- Recall over problematic vendors: **88.9% (8/9, 95% CI 56.5–98.0%)**
- False-positive rate over sampled clean vendors: **10.0% (2/20, 95% CI 2.8–30.1%)**
- Hard-negative control: 0 documented-clean gold cases currently link to vendors in the data (the vaccine-APA case is program-level), so this control has NOT been exercised yet.

Small-n honesty: with n this size the confidence intervals above are wide —
treat these as screening-level evidence of signal, not calibrated performance
numbers. The problematic cohort is also cluster-correlated (several vendors
share the ArriveCAN scandal), and indicator thresholds were designed against
the same public cases the gold set draws from (labels are independent of the
rules, but this is an in-sample evaluation — there is no held-out set yet).

## Agent-level (grounding audit of every stored brief)
- Briefs audited: 14 (model: 0, fallback rate 100.0%)
- **Hallucinated-figure rate in accepted briefs: 0.0%** (0/14)
- First-try-valid rate (model briefs): n/a · avg attempts: n/a

> Data: official Proactive Disclosure of Contracts over $10,000 — all indicators active (procedure, bid-count, amendment). sampled_clean = absence of adverse findings, a weaker label than a clean audit (see FEASIBILITY.md); a higher false-positive rate reflects more indicators firing, not miscalibration. NOTE: the model API was unavailable this run, so every brief used the deterministic fallback — hallucinated-figure rate is 0% by construction. The identical grounding validation applies to model briefs.
