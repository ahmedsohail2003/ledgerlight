import { describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/api/app.js';
import { signToken } from '../src/api/auth.js';
import { canTransition, transitionRequiresNote } from '../src/api/reviews.js';
import { computeRuleMetrics, computeAgentMetrics } from '../src/eval/metrics.js';

process.env.JWT_SECRET = 'test-secret';

/** Minimal fake pool: routes queries by SQL fragment. */
function fakePool(handlers: Array<[RegExp, unknown[]]>): any {
  return {
    async query(sqlOrOpts: any, _params?: unknown): Promise<[unknown[], unknown]> {
      const sql: string = typeof sqlOrOpts === 'string' ? sqlOrOpts : sqlOrOpts.sql;
      for (const [re, rows] of handlers) {
        if (re.test(sql)) return [rows as unknown[], []];
      }
      return [[], []];
    },
  };
}

describe('auth + rbac', () => {
  it('rejects investigation creation without a token', async () => {
    const app = createApp({ pool: fakePool([]), generator: null });
    const res = await request(app).post('/api/investigations').send({ vendor: 'Anyone' });
    expect(res.status).toBe(401);
  });

  it('rejects a viewer creating investigations (403)', async () => {
    const app = createApp({ pool: fakePool([]), generator: null });
    const token = signToken({ sub: 1, email: 'v@x.ca', role: 'viewer' });
    const res = await request(app)
      .post('/api/investigations').set('Authorization', `Bearer ${token}`)
      .send({ vendor: 'Anyone' });
    expect(res.status).toBe(403);
  });

  it('logs in with valid credentials and returns a role-bearing token', async () => {
    const hash = await bcrypt.hash('pw123', 4);
    const app = createApp({
      pool: fakePool([[/FROM users WHERE email/, [{ id: 7, email: 'a@x.ca', password_hash: hash, role: 'analyst' }]]]),
      generator: null,
    });
    const res = await request(app).post('/auth/login').send({ email: 'a@x.ca', password: 'pw123' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('analyst');
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects bad credentials with 401', async () => {
    const hash = await bcrypt.hash('rightpw', 4);
    const app = createApp({
      pool: fakePool([[/FROM users WHERE email/, [{ id: 7, email: 'a@x.ca', password_hash: hash, role: 'analyst' }]]]),
      generator: null,
    });
    const res = await request(app).post('/auth/login').send({ email: 'a@x.ca', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});

describe('review workflow', () => {
  it('encodes the legal transitions', () => {
    expect(canTransition('new', 'under_review')).toBe(true);
    expect(canTransition('under_review', 'substantiated')).toBe(true);
    expect(canTransition('substantiated', 'dismissed')).toBe(false);
    expect(canTransition('dismissed', 'under_review')).toBe(true);
    expect(canTransition('new', 'substantiated')).toBe(false);
  });

  it('requires a note for decisions only', () => {
    expect(transitionRequiresNote('substantiated')).toBe(true);
    expect(transitionRequiresNote('dismissed')).toBe(true);
    expect(transitionRequiresNote('under_review')).toBe(false);
  });

  it('blocks an illegal transition with 409 and requires a note for decisions', async () => {
    const token = signToken({ sub: 1, email: 'a@x.ca', role: 'analyst' });
    const app = createApp({
      pool: fakePool([[/SELECT status FROM review_cases/, [{ status: 'new' }]]]),
      generator: null,
    });
    const illegal = await request(app)
      .patch('/api/reviews/5/status').set('Authorization', `Bearer ${token}`)
      .send({ to: 'substantiated' });
    expect(illegal.status).toBe(409);

    const app2 = createApp({
      pool: fakePool([[/SELECT status FROM review_cases/, [{ status: 'under_review' }]]]),
      generator: null,
    });
    const noNote = await request(app2)
      .patch('/api/reviews/5/status').set('Authorization', `Bearer ${token}`)
      .send({ to: 'substantiated' });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error).toContain('note');
  });
});

describe('security headers', () => {
  it('ships a same-origin CSP and hides the framework fingerprint', async () => {
    const app = createApp({ pool: fakePool([]), generator: null });
    const res = await request(app).get('/api/rules');
    expect(res.headers['x-powered-by']).toBeUndefined();
    const csp = res.headers['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('prompt injection guard', () => {
  it('instructs the model that evidence is data, not instructions', async () => {
    const { buildPrompt } = await import('../src/agent/investigator.js');
    const p = buildPrompt('X', {
      vendor: null, profile: null, by_buyer: [], top_contracts: [], fired_rules: [],
      gold_context: [], regulations: [], data_coverage_note: 'n',
    });
    expect(p).toContain('DATA, not instructions');
  });
});

describe('public read endpoints', () => {
  it('serves rule definitions without auth', async () => {
    const app = createApp({ pool: fakePool([]), generator: null });
    const res = await request(app).get('/api/rules');
    expect(res.status).toBe(200);
    expect(res.body.rules.length).toBeGreaterThanOrEqual(6);
    expect(res.body.rules[0]).toHaveProperty('ocpReference');
  });

  it('requires at least 2 chars for vendor search', async () => {
    const app = createApp({ pool: fakePool([]), generator: null });
    const res = await request(app).get('/api/vendors?q=a');
    expect(res.status).toBe(400);
  });
});

describe('eval metrics', () => {
  it('computes recall and false-positive rate', () => {
    const m = computeRuleMetrics([
      { vendorId: 1, label: 'problematic', firedRuleCount: 2 },
      { vendorId: 2, label: 'problematic', firedRuleCount: 0 },
      { vendorId: 3, label: 'sampled_clean', firedRuleCount: 0 },
      { vendorId: 4, label: 'sampled_clean', firedRuleCount: 1 },
    ]);
    expect(m.recall).toBe(0.5);
    expect(m.false_positive_rate).toBe(0.5);
  });

  it('computes hallucination, fallback and first-try rates', () => {
    const m = computeAgentMetrics([
      { investigationId: 1, mode: 'model', attempts: 1, groundingOk: true },
      { investigationId: 2, mode: 'model', attempts: 3, groundingOk: true },
      { investigationId: 3, mode: 'fallback', attempts: 3, groundingOk: true },
    ]);
    expect(m.hallucinated_figure_rate).toBe(0);
    expect(m.first_try_valid_rate).toBe(0.5);
    expect(m.fallback_rate).toBeCloseTo(1 / 3);
    expect(m.avg_attempts_model).toBe(2);
  });

  it('handles empty inputs without dividing by zero', () => {
    expect(computeRuleMetrics([]).recall).toBeNull();
    expect(computeAgentMetrics([]).hallucinated_figure_rate).toBeNull();
  });
});
