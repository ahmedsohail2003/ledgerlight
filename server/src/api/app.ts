import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Pool } from 'mysql2/promise';
import { authenticate, requireRole, signToken } from './auth.js';
import { canTransition, transitionRequiresNote, type ReviewStatus } from './reviews.js';
import { buildVendorEvidence } from '../agent/tools.js';
import { investigateVendor, persistInvestigation } from '../agent/investigator.js';
import { createGeminiGenerator, hasApiKey, type BriefGenerator } from '../agent/gemini.js';
import { RULES } from '../rules/indicators/index.js';

export interface AppDeps {
  pool: Pool;
  /** SELECT-only pool for agent evidence assembly; defaults to `pool`. */
  roPool?: Pool;
  /** Injectable for tests; defaults to the real Gemini generator when a key exists. */
  generator?: BriefGenerator | null;
}

export function createApp({ pool, roPool, generator }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    // Explicit CSP: same-origin app; style attr needed by the bar charts;
    // no upgrade-insecure-requests so plain-HTTP local demos keep working
    // (TLS terminates at the edge in a real deployment — see SECURITY.md).
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
  // Credential endpoints get a much tighter budget than general reads.
  app.use('/auth/login', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));
  app.use(authenticate);

  const resolveGenerator = (): BriefGenerator | null =>
    generator !== undefined ? generator : (hasApiKey() ? createGeminiGenerator() : null);

  // ---------- auth ----------
  const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
  app.post('/auth/login', async (req, res, next) => {
    try {
      const body = LoginBody.safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: 'email and password required' });
      const [rows] = await pool.query<any[]>(
        'SELECT id, email, password_hash, role FROM users WHERE email = ?',
        [body.data.email],
      );
      const user = rows[0];
      const ok = user && await bcrypt.compare(body.data.password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'invalid credentials' });
      await pool.query(
        `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, 'login', 'user', ?, NULL)`,
        [user.email, String(user.id)],
      );
      return res.json({ token: signToken({ sub: user.id, email: user.email, role: user.role }), role: user.role });
    } catch (err) { next(err); }
  });

  // ---------- vendors (public read) ----------
  app.get('/api/vendors', async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) return res.status(400).json({ error: 'q must be at least 2 characters' });
      const [rows] = await pool.query<any[]>(
        `SELECT v.id, v.canonical_name, COUNT(c.id) AS contract_count,
                ROUND(COALESCE(SUM(c.contract_value), 0), 2) AS total_value
         FROM vendors v LEFT JOIN contracts c ON c.vendor_id = v.id
         WHERE v.canonical_name LIKE CONCAT('%', ?, '%')
         GROUP BY v.id, v.canonical_name
         ORDER BY contract_count DESC LIMIT 20`,
        [q],
      );
      return res.json({ vendors: rows });
    } catch (err) { next(err); }
  });

  app.get('/api/vendors/:id/evidence', async (req, res, next) => {
    try {
      const [rows] = await pool.query<any[]>('SELECT canonical_name FROM vendors WHERE id = ?', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'vendor not found' });
      const pack = await buildVendorEvidence(roPool ?? pool, rows[0].canonical_name);
      return res.json(pack);
    } catch (err) { next(err); }
  });

  // ---------- regulation corpus (public read) ----------
  app.get('/api/regulations', async (_req, res, next) => {
    try {
      const [rows] = await pool.query<any[]>(
        'SELECT chunk_id, doc, section_ref, title, text, source_url FROM regulation_chunks ORDER BY chunk_id',
      );
      return res.json({ regulations: rows });
    } catch (err) { next(err); }
  });

  // ---------- rules (public read) ----------
  app.get('/api/rules', (_req, res) => {
    res.json({
      rules: RULES.map(({ id, title, ocpReference, severity, requires, description }) => ({
        id, title, ocpReference, severity, requires, description,
      })),
    });
  });

  // ---------- investigations ----------
  app.get('/api/investigations', async (_req, res, next) => {
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT id, target_ref, mode, attempts, status, created_at FROM investigations ORDER BY id DESC LIMIT 50`,
      );
      return res.json({ investigations: rows });
    } catch (err) { next(err); }
  });

  app.get('/api/investigations/:id', async (req, res, next) => {
    try {
      const [rows] = await pool.query<any[]>('SELECT * FROM investigations WHERE id = ?', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'not found' });
      return res.json(rows[0]);
    } catch (err) { next(err); }
  });

  const InvestigateBody = z.object({ vendor: z.string().min(2).max(255) });
  app.post('/api/investigations', requireRole('analyst'), async (req, res, next) => {
    try {
      const body = InvestigateBody.safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: 'vendor (2-255 chars) required' });
      const gen = resolveGenerator();
      const result = await investigateVendor(pool, body.data.vendor, gen, roPool ?? pool);
      const id = await persistInvestigation(pool, body.data.vendor, result, gen?.modelId ?? null);
      return res.status(201).json({ id, mode: result.mode, attempts: result.attempts, brief: result.brief });
    } catch (err) { next(err); }
  });

  // ---------- review kanban ----------
  app.get('/api/reviews', async (_req, res, next) => {
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT r.id, r.title, r.status, r.vendor_id, v.canonical_name AS vendor,
                r.investigation_id, r.decision_note, r.created_at, r.updated_at
         FROM review_cases r LEFT JOIN vendors v ON v.id = r.vendor_id
         ORDER BY r.updated_at DESC LIMIT 200`,
      );
      return res.json({ reviews: rows });
    } catch (err) { next(err); }
  });

  const OpenReviewBody = z.object({
    title: z.string().min(3).max(512),
    vendor_id: z.number().int().positive().optional(),
    investigation_id: z.number().int().positive().optional(),
  });
  app.post('/api/reviews', requireRole('analyst'), async (req, res, next) => {
    try {
      const body = OpenReviewBody.safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? 'invalid body' });
      const [result] = await pool.query<any>(
        `INSERT INTO review_cases (title, vendor_id, investigation_id, opened_by) VALUES (?, ?, ?, ?)`,
        [body.data.title, body.data.vendor_id ?? null, body.data.investigation_id ?? null, req.auth!.sub],
      );
      await pool.query(
        `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, 'open_review', 'review_case', ?, ?)`,
        [req.auth!.email, String(result.insertId), JSON.stringify(body.data)],
      );
      return res.status(201).json({ id: result.insertId, status: 'new' });
    } catch (err) { next(err); }
  });

  const TransitionBody = z.object({
    to: z.enum(['new', 'under_review', 'substantiated', 'dismissed']),
    note: z.string().max(4000).optional(),
  });
  app.patch('/api/reviews/:id/status', requireRole('analyst'), async (req, res, next) => {
    try {
      const body = TransitionBody.safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: 'to must be a valid status' });
      const [rows] = await pool.query<any[]>('SELECT status FROM review_cases WHERE id = ?', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'not found' });
      const from = rows[0].status as ReviewStatus;
      const to = body.data.to as ReviewStatus;
      if (!canTransition(from, to)) {
        return res.status(409).json({ error: `illegal transition ${from} → ${to}` });
      }
      if (transitionRequiresNote(to) && !body.data.note?.trim()) {
        return res.status(400).json({ error: `a decision note is required to mark a case ${to}` });
      }
      await pool.query(
        `UPDATE review_cases SET status = ?, decided_by = ?, decision_note = COALESCE(?, decision_note) WHERE id = ?`,
        [to, req.auth!.sub, body.data.note ?? null, req.params.id],
      );
      await pool.query(
        `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, 'transition_review', 'review_case', ?, ?)`,
        [req.auth!.email, String(req.params.id), JSON.stringify({ from, to, note: body.data.note ?? null })],
      );
      return res.json({ id: Number(req.params.id), status: to });
    } catch (err) { next(err); }
  });

  // ---------- ops metrics ----------
  app.get('/api/metrics', async (_req, res, next) => {
    try {
      const [inv] = await pool.query<any[]>(
        `SELECT mode, COUNT(*) AS n, AVG(attempts) AS avg_attempts FROM investigations GROUP BY mode`,
      );
      const [firstTry] = await pool.query<any[]>(
        `SELECT SUM(mode = 'model' AND attempts = 1) AS first_try_valid,
                SUM(mode = 'model') AS model_total,
                COUNT(*) AS total
         FROM investigations`,
      );
      const [ruleCounts] = await pool.query<any[]>(
        `SELECT rule_id, COUNT(*) AS findings FROM rule_results
         WHERE run_id = (SELECT run_id FROM rule_results ORDER BY computed_at DESC LIMIT 1)
         GROUP BY rule_id`,
      );
      const [reviewCounts] = await pool.query<any[]>(
        `SELECT status, COUNT(*) AS n FROM review_cases GROUP BY status`,
      );
      // Latest eval audit (hallucination rate etc.) comes from the eval
      // harness's output file — never hardcoded in the UI.
      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
      let latestEval: unknown = null;
      try {
        const raw = await readFile(path.join(repoRoot, 'docs/eval/eval-results.json'), 'utf8');
        const parsed = JSON.parse(raw);
        latestEval = { ruleMetrics: parsed.ruleMetrics ?? null, agentMetrics: parsed.agentMetrics ?? null };
      } catch { /* no eval run yet */ }
      const f = firstTry[0] ?? {};
      return res.json({
        latest_eval: latestEval,
        investigations: inv,
        first_try_valid_rate: Number(f.model_total) > 0 ? Number(f.first_try_valid) / Number(f.model_total) : null,
        fallback_rate: Number(f.total) > 0 ? 1 - Number(f.model_total) / Number(f.total) : null,
        latest_rule_run: ruleCounts,
        review_queue: reviewCounts,
      });
    } catch (err) { next(err); }
  });

  // ---------- errors ----------
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
