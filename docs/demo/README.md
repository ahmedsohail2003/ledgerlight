# Demo

Captured from the live local stack (Express + MySQL holding 1,313,396 real
contract rows) with Playwright.

| File | What it is |
|---|---|
| `ledgerlight-brief.gif` | 8s loop of the integrity brief — the provenance colours, evidence refs, and the clause-linked regulation citation. Used as the README hero (GIFs autoplay inline on GitHub). |
| `ledgerlight-demo.mp4` | Full 31s captioned walkthrough: sign-in → vendor search → brief → review board → metrics. H.264, plays in any browser. |
| `ledgerlight-demo.webm` | Playwright's original VP8 recording (source for the two above). |

Stills live in [`../samples/`](../samples/): `search.png`,
`brief-gc-strategies.png`, `brief-dark.png`, `kanban.png`, `metrics.png`, plus
`brief-gc-strategies.md` (the same brief as text).

> **On inline video:** GitHub does not play video files referenced by relative
> path in a README — they render as links. That is why the hero is a GIF. To get
> an inline player, drag `ledgerlight-demo.mp4` into a GitHub issue or release
> and use the resulting `user-images.githubusercontent.com` URL.

> **On the briefs shown:** these come from the deterministic fallback path (no
> LLM credits at capture time), which is itself the graceful-degradation demo —
> identical grounding guarantees, zero free-form generation. Model-authored
> briefs render the same way, with `attempts` and rejected-draft counts filled in.
