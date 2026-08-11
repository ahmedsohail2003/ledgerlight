# Demo

**`ledgerlight-demo.webm`** — a captioned screen recording of the running app:
sign in → search real vendors (Dalian: 900+ contracts) → a grounded integrity
brief with a clause-linked regulation citation → the human-in-the-loop review
board → live metrics (0.0% hallucinated figures, audited).

Recorded against the live local stack (Express + MySQL with 1.31M real
contract rows) with Playwright. Stills in `../samples/`:

| | |
|---|---|
| `search.png` | Vendor search over the official dataset |
| `brief-gc-strategies.png` | Grounded brief — figures trace to refs; the sole-source flag cites GCR s.6 |
| `brief-dark.png` | Same brief, dark mode |
| `kanban.png` | Review board (decision notes required for verdicts) |
| `metrics.png` | Live agent + rule metrics |

Briefs in this recording come from the deterministic fallback path (no LLM
key configured at capture time) — which is itself the demo of graceful
degradation: identical grounding guarantees, zero free-form text.
