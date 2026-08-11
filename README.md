# Ledgerlight

**AI-assisted oversight of real Canadian public procurement — with an AI that is structurally forbidden from making things up.**

Ledgerlight loads the Government of Canada's entire [Proactive Disclosure of Contracts over $10,000](https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b) dataset (~1.29 million real contract rows), runs deterministic red-flag indicators derived from the [Open Contracting Partnership's red-flag guide](https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement-1.pdf) over it, and puts a grounding-validated Gemini investigator on top. Ask it about a vendor and it writes a plain-language **integrity brief** in which:

- **every number must trace to a source value** in the evidence pack (declared with a JSON path, byte-checked),
- **every red flag must cite an indicator that actually fired** (deterministic SQL, not vibes),
- **every citation of the law must resolve to a clause actually retrieved** from the [Government Contracts Regulations](https://laws-lois.justice.gc.ca/eng/regulations/SOR-87-402/FullText.html),
- and everything the model merely *thinks* is visibly labeled **model inference** and may carry no figures at all.

A draft that breaks any rule is mechanically rejected and re-prompted with the exact reason; after three failures the system emits a deterministic template brief instead. **The hallucination rate of accepted briefs is 0% by construction — and the eval harness re-audits every stored brief to prove it rather than assert it.**

Every flag is framed as an *indicator warranting review*, never an accusation — and nothing becomes "substantiated" without a human analyst recording a written justification on the review board.

## Why this exists

Canada's procurement scandals (ArriveCAN, the McKinsey contracts, Phoenix) were surfaced by auditors doing months of manual cross-referencing. The data to spot the patterns — sole-source codes, bid counts, amendment trails — is public. Ledgerlight is an exploration of what responsible AI tooling for that oversight work looks like: deterministic rules for detection, an LLM only for narration, and a validation layer that makes the LLM's failure modes structurally impossible rather than merely unlikely.

## What's inside

| Layer | Stack | The interesting part |
|---|---|---|
| Data | MySQL 8, streaming two-pass ETL (Node/TS) | Full 43-column official layout; amendments as C/A instrument rows; conservative name normalization + curated aliases |
| Rules | 6 parameterized SQL indicators | OCP-derived; non-competitive, single-bid, amendment-inflation, threshold-splitting (GCR s.6(b) ceilings), repeat-awards, concentration |
| Agent | Gemini (structured output) + Zod + grounding validator | Corrective re-prompt quoting exact rejections; deterministic fallback; SELECT-only DB identity for everything the model touches |
| RAG | Deterministic TF-IDF over SOR/87-402 clauses | Stable chunk IDs; citations validated against the retrieved set (no legal hallucinations) |
| Eval | Gold set from OAG/OPO/parliament/suspensions | Non-circular by design; recall/FPR + a grounding re-audit of every stored brief |
| API | Express 5, JWT/RBAC, helmet CSP, rate limits | Append-only audit log **enforced by MySQL grants**, not convention |
| UI | React 19 + TypeScript + Vite | Provenance-colored briefs with clickable law citations; drag-and-drop review board with mandatory decision notes; live metrics |
| Infra | Dockerfile + Terraform (App Runner + private RDS + Secrets Manager) | AWS-ready by design; run locally today, one command to go live |

## Evaluation, honestly

The gold set labels vendors from **independent** findings — Auditor General audits (ArriveCAN, McKinsey, GC Strategies government-wide, Phoenix), Procurement Ombud reviews, PSPC suspensions, parliamentary reports — never from the rules themselves. Headline results on the official dataset (see `docs/eval/`):

- **Rule-level recall 80%** over independently-labeled problematic vendors; false-positive rate 20% over sampled-clean vendors (sampled-clean is a weaker label, and the report says so).
- **Hallucinated figures in accepted briefs: 0%**, verified by re-auditing every stored brief against a freshly built evidence pack.
- The vaccine advance-purchase agreements are the built-in **hard-negative control**: sole-source heuristics fire on them, the independent label is clean — a test that the system doesn't over-accuse.

## Run it

```bash
# 1. MySQL (Docker) + env
docker compose up -d mysql
cp .env.example .env   # fill in passwords; GEMINI_API_KEY optional (fallback mode without it)

# 2. Install, schema, identities, corpus, users
npm install
npm run migrate --workspace @ledgerlight/server
mysql -u root < server/src/db/grants.sql
npm run rag:load --workspace @ledgerlight/server
npm run seed:users --workspace @ledgerlight/server

# 3. Data (download ~600MB official CSV, then load ~1.29M rows)
curl -L -o data/raw/contracts.csv "https://open.canada.ca/data/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b/resource/fac950c0-00d5-4ec1-a4d3-9cbebf98a305/download/contracts.csv"
npm run etl:official --workspace @ledgerlight/server
npm run goldset:load --workspace @ledgerlight/server
npm run rules:run --workspace @ledgerlight/server

# 4. Evaluate, build, serve
npm run eval --workspace @ledgerlight/server
npm run build --workspace @ledgerlight/web
npm run api --workspace @ledgerlight/server   # http://localhost:8080
```

`npm test` / `npm run typecheck` in `server/`; CI runs both plus the web build.

## Design documents

- [`SECURITY.md`](SECURITY.md) — STRIDE model, LLM-specific threats (the grounding validator as a security boundary), OWASP Top 10 mapping, honest gap list
- [`docs/research/FEASIBILITY.md`](docs/research/FEASIBILITY.md) — the gold-set research, data-quality gotchas, negative-sampling protocol
- [`infra/README.md`](infra/README.md) — AWS architecture, one-command deploy, cost table
- [`docs/eval/`](docs/eval/) — machine-written evaluation reports
- [`docs/demo/`](docs/demo/) — screenshots and walkthrough

## Limitations (read before quoting numbers)

Vendor names are normalized conservatively, not entity-resolved — one supplier can appear under several spellings. Amendment linkage uses `procurement_id`, which is imperfectly populated. Red-flag indicators are *screening heuristics* with documented thresholds, not findings; the OAG/OPO citations in the gold set describe those institutions' conclusions, not this tool's. The `alleged` label is used wherever no final official finding exists.

---

*Built by Ahmed Sohail Butt as an AI-assisted engineering project. The AI collaboration is part of the point: the same validate-or-reject discipline the app enforces on its own model was applied to the code the model helped write — tests, typechecks, live verification, and honest evaluation throughout.*
