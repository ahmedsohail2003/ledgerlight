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
| **T**ampering | Rewriting the audit trail or briefs | `audit_log` is INSERT+SELECT-only for the app user — enforced by MySQL grants (`server/src/db/grants.sql`), verified by test insert/update denial; briefs persist with full rejection history (`investigator.ts`) | A DB admin can still tamper (G-6: prod needs write-once storage/log shipping) |
| **R**epudiation | "Nobody decided that" | Every login, investigation, rule run, review transition, and decision note is audit-logged with actor + detail (`app.ts`, `investigator.ts`, `engine.ts`); decisions REQUIRE a written note (`reviews.ts` `transitionRequiresNote`) | Clock is DB-local; no external anchor |
| **I**nfo disclosure | Secrets or non-public data leaking | Secrets env-only (`config.ts`, `.gitignore`); all contract data is already public; only open data is sent to the LLM | Gemini sees vendor queries (G-7) |
| **D**oS | Request floods; expensive LLM calls | Global rate limit 120/min + login limit 10/min + JSON body cap 256kb (`app.ts`); LLM calls behind analyst role + bounded retries (max 3, `investigator.ts`) | Limiter is in-memory/single-instance (G-4) |
| **E**levation | Viewer/anon acting as analyst; SQL injection; LLM-driven writes | Role middleware on every mutation (`app.ts`); ALL SQL parameterized (`mysql2` placeholders, no string concat anywhere); **the agent's entire read path runs on a SELECT-only DB user** (`pool.ts` `getRoPool`, `grants.sql`) | — |

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
   over with zero free-form text (`fallback.ts`).
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
| A06 Vulnerable components | ⚠️ | Small, current dependency set; **no automated scanning in CI yet** (G-5) |
| A07 Auth failures | ⚠️ | Login rate-limited 10/min; generic error on bad credentials; no MFA/lockout (G-2) |
| A08 Data integrity failures | ✅ | The core feature: grounding validation + provenance + append-only audit; eval re-audits stored briefs |
| A09 Logging failures | ✅ | Structured audit_log for every security-relevant event; rejection history persisted per investigation |
| A10 SSRF | ✅ | No user-supplied URLs are fetched anywhere |

## NIST CSF 2.0 (summary mapping)

- **Identify**: data classification + trust boundaries above; gold-set/data provenance documented in `docs/research/`.
- **Protect**: RBAC, least-privilege DB identities (admin/app/ro), secrets hygiene, CSP, rate limits, input validation.
- **Detect**: grounding validator (integrity violations surface as rejections), eval harness re-audit, audit log.
- **Respond**: fallback mode keeps service defensible under model failure; review board routes contested flags to humans.
- **Recover**: G-6 — no tested backup/restore yet; MySQL dump strategy needed for prod.

## Gaps (accepted for local demo; ranked)

| # | Gap | Remediation path |
|---|---|---|
| G-1 | No TLS on the local demo | Terminate TLS at the edge (App Runner/CloudFront) in the AWS deployment; HSTS already shipped by helmet |
| G-2 | No MFA, no account lockout, demo passwords | Real IdP (Cognito/Entra) before any real analyst uses it |
| G-3 | JWT in localStorage → XSS-readable | CSP is the compensating control; move to httpOnly SameSite cookies + CSRF token if cookie auth is adopted |
| G-4 | Rate limiter is in-memory | Redis-backed store for multi-instance deployments |
| G-5 | No dependency/secret scanning in CI | Add `npm audit` + secret-scan job |
| G-6 | Audit log append-only only at the grant layer; no backups | Ship logs to write-once storage (S3 object lock); scheduled dumps + restore test |
| G-7 | Vendor names queried are visible to the LLM provider | Acceptable (public data); document in any privacy review |
| G-8 | Demo credentials documented for reviewers | Rotate/remove before any non-demo exposure |
