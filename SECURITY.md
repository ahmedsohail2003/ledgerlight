# Security assessment — Ledgerlight

Self-assessment of the current codebase: STRIDE threat model, OWASP Top 10
(2021) mapping, LLM-specific analysis, and an honest gap list. Every
"implemented" control cites the code that enforces it. Last reviewed alongside
the security hardening commit; re-review when the deployment story changes.

## Data classification

| Asset | Sensitivity | Notes |
|---|---|---|
| Contract data | **Public** | Government of Canada proactive-disclosure open data |
| Gold-set labels & evidence | **Public** | Compiled from published audits, reviews, journalism |
| User accounts | Low (demo) | Two seeded demo identities; bcrypt-hashed passwords |
| Audit log | Integrity-critical | The accountability record; append-only by DB grant |
| Secrets (`GEMINI_API_KEY`, `JWT_SECRET`, DB creds) | **Secret** | Env-only; `.env` gitignored; `.env.example` committed |

The system stores no personal information; the privacy surface is minimal by
design. The critical properties are **integrity** (numbers/flags must trace to
source) and **accountability** (who decided what, when).

## Trust boundaries

```
Browser (React SPA)
   │  B1: HTTP + JWT
   ▼
Express API ──────────► MySQL
   │        B3: app user (per-table DML, audit_log append-only)
   │        B4: ro user (SELECT only) ← evidence assembly
   │  B2: HTTPS
   ▼
Gemini API (untrusted output)     CSV open data ──► ETL (B5)
```

## STRIDE

| Threat | Vector | Mitigation (code) | Residual |
|---|---|---|---|
| **S**poofing | Forged identity to mutate state | JWT (HS256, 8h expiry) required for all mutations; role checks — `server/src/api/auth.ts` (`requireRole`), bcrypt password hashes (`seed-users.ts`) | No MFA; JWT in localStorage (see gaps G-2, G-3) |
| **T**ampering | Rewriting the audit trail or briefs | `audit_log` is INSERT+SELECT-only for the app user — enforced by MySQL grants that bind to the connection identities every supported setup actually uses (`grants.sql` bootstrap creates localhost/127.0.0.1/`%` variants and auto-applies in compose via `docker-entrypoint-initdb.d`; per-table grants land in migration `006_app_grants.sql`), **verified by `server/test/db-grants.integration.test.ts`**, which connects as the app and ro identities and asserts UPDATE/DELETE/INSERT denials (gated behind `LEDGERLIGHT_DB_TESTS=1`; run it against any live setup); briefs persist with full rejection history (`investigator.ts`) | A DB admin can still tamper (G-6: prod needs write-once storage/log shipping) |
| **R**epudiation | "Nobody decided that" | Every login, investigation, rule run, review transition, and decision note is audit-logged with actor + detail (`app.ts`, `investigator.ts`, `engine.ts`); decisions REQUIRE a written note (`reviews.ts` `transitionRequiresNote`) | Clock is DB-local; no external anchor |
| **I**nfo disclosure | Secrets or non-public data leaking | Secrets env-only (`config.ts`, `.gitignore`); all contract data is already public; only open data is sent to the LLM | Gemini sees vendor queries (G-7) |
| **D**oS | Request floods; expensive LLM calls | Global rate limit 120/min + login limit 10/min + JSON body cap 256kb (`app.ts`); LLM calls behind analyst role + bounded retries (max 3, `investigator.ts`) | Limiter is in-memory/single-instance (G-4) |
| **E**levation | Viewer/anon acting as analyst; SQL injection; LLM-driven writes | Role middleware on every mutation (`app.ts`); ALL SQL parameterized (`mysql2` placeholders, no string concat anywhere); **the agent's entire read path runs on a SELECT-only DB user, and the pool FAILS CLOSED** — if `DB_RO_USER` is unset the process refuses to start instead of silently downgrading to the write identity (`pool.ts` `getRoPool`; explicit demo opt-out via `ALLOW_SINGLE_DB_IDENTITY=1` is loudly logged) | — |

## LLM-specific threats (the interesting part)

**Prompt injection via data.** Contract descriptions and vendor names are
attacker-influenceable text (any supplier can name itself anything). Defenses,
in depth:
1. The prompt explicitly marks the evidence pack as *data, not instructions*
   (`investigator.ts` `buildPrompt`).
2. **The grounding validator is the real security boundary** — even a fully
   hijacked model cannot emit an unmatched figure, an unfired flag, or an
   unretrieved regulation citation; such drafts are rejected mechanically
   (`grounding.ts`), and after 3 failures the deterministic fallback takes
   over with zero free-form text (`fallback.ts`). The boundary covers EVERY
   free-text surface of the brief — claims, headline, and limitations — plus
   the `overall_assessment` verdict (which may not contradict the fired-rule
   set), and evidence refs resolve only to own data properties (no `.length`
   or prototype tricks). Because a boundary is only as good as its tests, a
   standing **red-team suite attacks the validator itself** with seeded
   hallucination briefs on every CI run (`npm run eval:redteam`,
   `docs/eval/red-team-report.md`) and fails the build if any attack lands.
   Its known residual gaps (word-form numbers, year-formatted counts) are
   listed in the report rather than left unstated.
3. The model's DB access is zero: it never queries; it receives a pre-built
   pack assembled over the SELECT-only pool.
4. Residual: `model_inference` prose could still carry manipulative *wording*
   inside validated structure — mitigated by visible provenance labeling in the
   UI and human review before anything is "substantiated".

**Insecure output handling.** Briefs are structured JSON validated by Zod
before any use (`brief-schema.ts`); the UI renders text through React (auto-
escaped), never `dangerouslySetInnerHTML`.

**Model availability.** An API error (rate limit, auth, outage) degrades to
the deterministic fallback rather than failing the request (`investigator.ts`);
a missing key can never trigger a network call (`gemini.ts` `hasApiKey`).

## OWASP Top 10 (2021)

| | Status | Evidence |
|---|---|---|
| A01 Broken access control | ✅ | `requireRole` on every mutation; viewer/analyst separation; review transitions server-validated (409 on illegal moves) |
| A02 Cryptographic failures | ⚠️ | bcrypt(10) passwords; JWT HS256; **no TLS in local demo** (G-1) |
| A03 Injection | ✅ | 100% parameterized SQL; Zod on every body; React escaping; prompt-injection defenses above |
| A04 Insecure design | ✅ | Human-in-the-loop by design; append-only audit; deterministic fallback; abuse cases documented here |
| A05 Security misconfiguration | ✅ | helmet with explicit same-origin CSP, `frame-ancestors 'none'`, nosniff; `x-powered-by` disabled; JSON size cap |
| A06 Vulnerable components | ✅ | Small, current dependency set; CI runs `npm audit` (fails on high/critical) plus a full-history secret scan on every push (`.github/workflows/ci.yml`) |
| A07 Auth failures | ⚠️ | Login rate-limited 10/min; generic error on bad credentials; no MFA/lockout (G-2) |
| A08 Data integrity failures | ✅ | The core feature: grounding validation + provenance + append-only audit; eval re-audits stored briefs |
| A09 Logging failures | ✅ | Structured audit_log for every security-relevant event; rejection history persisted per investigation |
| A10 SSRF | ✅ | No user-supplied URLs are fetched anywhere |

## NIST CSF 2.0 (summary mapping)

- **Identify**: data classification + trust boundaries above; gold-set/data provenance documented in `docs/research/`.
- **Protect**: RBAC, least-privilege DB identities (admin/app/ro), secrets hygiene, CSP, rate limits, input validation.
- **Detect**: grounding validator (integrity violations surface as rejections), eval harness re-audit, audit log, CI dependency + secret scanning.
- **Respond**: fallback mode keeps service defensible under model failure; review board routes contested flags to humans.
- **Recover**: G-6 — no tested backup/restore yet; MySQL dump strategy needed for prod.

## Residual risk (scoped, ranked)

This is a deliberate risk register, not a to-do list. Each item below is a
conscious scoping decision for a **local, single-instance demo over public
data**, with the condition that would change the answer. Closing all of them
would mean standing up an identity provider, Redis, and write-once log storage
for a portfolio project — the wrong trade. Items are closed when the fix is
cheap and real (see G-5, now shipped).

| # | Residual risk | Decision & trigger to revisit |
|---|---|---|
| G-1 | No TLS on the local demo | **Architecturally answered.** App Runner terminates HTTPS in the Terraform deployment and helmet already sends HSTS; TLS on a localhost demo would be theatre. |
| G-2 | No MFA; no per-account lockout; seeded demo passwords | **Accepted.** The 10 req/min login limiter blunts brute force, and the only accounts are two demo identities over public data. Trigger: any real analyst account → federate to a real IdP (Cognito/Entra) and add per-account lockout. |
| G-3 | JWT in `localStorage` (readable by XSS) | **Accepted trade, not an oversight.** httpOnly cookies would resist XSS but require CSRF defences — trading one attack class for another. The same-origin CSP (`script-src 'self'`, no inline scripts) is the compensating control. Trigger: adopting cookie auth → add SameSite + CSRF tokens together. |
| G-4 | Rate limiter is in-process memory | **Accepted.** Correct for one instance; a shared store would be premature. Trigger: >1 App Runner instance → Redis-backed store. |
| G-5 | ~~No dependency or secret scanning in CI~~ | ✅ **Closed.** CI now runs four gates on every push: `npm audit --audit-level=high`; an assertion that no `.env`, CSV, or `node_modules` path exists anywhere in history; a credential-shape scan (Google/AWS keys, private-key blocks) across every commit; and a check that secret-named variables are never assigned literals. Adding the audit immediately surfaced a **critical and a high** advisory in the dev toolchain (vitest/vite), fixed by upgrading to `vitest@4` and `vite@8` — now **0 vulnerabilities**. The history/shape scans are self-contained rather than a third-party action and hermetic; `npm audit` is the one deliberately live gate — a new upstream advisory can (and should) turn CI red with no repo change. Both scan types were verified against planted test secrets before shipping. |
| G-6 | Audit log is append-only by DB grant; no backups or off-box copy | **Accepted for local.** A DB admin could still rewrite history. RDS backup retention is already set in Terraform. Trigger: production → ship the audit log to S3 with Object Lock and test a restore. |
| G-7 | Vendor names in queries are visible to the LLM provider | **Accepted.** Everything sent is already-published open data; no personal or non-public information exists in the system. Trigger: ingesting any non-public source → re-run this assessment first. |
| G-8 | Demo credentials are documented for reviewers | **Intentional** so the demo is reproducible. Trigger: any non-demo exposure → rotate and remove from docs. |
