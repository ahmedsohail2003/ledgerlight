/** Typed API client. The JWT lives in localStorage; every helper goes through
 *  request() so auth and error shaping stay in one place. */

export interface Claim {
  text: string;
  provenance: 'rule_derived' | 'sql_derived' | 'model_inference';
  rule_ids: string[];
  figures: { evidence_ref: string; value: number }[];
  regulation_citations: string[];
}
export interface RegulationChunk { chunk_id: string; doc: string; section_ref: string; title: string; text: string; source_url: string }
export interface Brief {
  target: string;
  headline: string;
  overall_assessment: 'indicators_warrant_review' | 'no_indicators_found' | 'insufficient_data';
  claims: Claim[];
  limitations: string;
}
export interface VendorHit { id: number; canonical_name: string; contract_count: number; total_value: number }
export interface RuleDef { id: string; title: string; ocpReference: string; severity: string; requires: string; description: string }
export interface InvestigationRow { id: number; target_ref: string; mode: 'model' | 'fallback'; attempts: number; status: string; created_at: string }
export interface ReviewCase {
  id: number; title: string; status: 'new' | 'under_review' | 'substantiated' | 'dismissed';
  vendor_id: number | null; vendor: string | null; investigation_id: number | null;
  decision_note: string | null; created_at: string; updated_at: string;
}

const TOKEN_KEY = 'ledgerlight.token';
const ROLE_KEY = 'ledgerlight.role';
const EMAIL_KEY = 'ledgerlight.email';

export const session = {
  get token(): string | null { return localStorage.getItem(TOKEN_KEY); },
  get role(): string | null { return localStorage.getItem(ROLE_KEY); },
  get email(): string | null { return localStorage.getItem(EMAIL_KEY); },
  set(token: string, role: string, email: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
    localStorage.setItem(EMAIL_KEY, email);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(EMAIL_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  async login(email: string, password: string): Promise<void> {
    const r = await request<{ token: string; role: string }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    session.set(r.token, r.role, email);
  },
  searchVendors: (q: string) =>
    request<{ vendors: VendorHit[] }>(`/api/vendors?q=${encodeURIComponent(q)}`),
  vendorEvidence: (id: number) => request<Record<string, unknown>>(`/api/vendors/${id}/evidence`),
  rules: () => request<{ rules: RuleDef[] }>('/api/rules'),
  regulations: () => request<{ regulations: RegulationChunk[] }>('/api/regulations'),
  investigations: () => request<{ investigations: InvestigationRow[] }>('/api/investigations'),
  investigation: (id: string) => request<{ id: number; target_ref: string; mode: string; attempts: number; brief: Brief | string; validation_failures: unknown; created_at: string }>(`/api/investigations/${id}`),
  investigate: (vendor: string) =>
    request<{ id: number; mode: string; attempts: number; brief: Brief }>('/api/investigations', {
      method: 'POST', body: JSON.stringify({ vendor }),
    }),
  reviews: () => request<{ reviews: ReviewCase[] }>('/api/reviews'),
  openReview: (title: string, vendor_id?: number, investigation_id?: number) =>
    request<{ id: number }>('/api/reviews', {
      method: 'POST', body: JSON.stringify({ title, vendor_id, investigation_id }),
    }),
  transitionReview: (id: number, to: string, note?: string) =>
    request<{ id: number; status: string }>(`/api/reviews/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ to, note }),
    }),
  metrics: () => request<{
    latest_eval: {
      ruleMetrics: { recall: number | null; false_positive_rate: number | null } | null;
      agentMetrics: { hallucinated_figure_rate: number | null; briefs_total: number } | null;
    } | null;
    investigations: { mode: string; n: number; avg_attempts: number }[];
    first_try_valid_rate: number | null;
    fallback_rate: number | null;
    latest_rule_run: { rule_id: string; findings: number }[];
    review_queue: { status: string; n: number }[];
  }>('/api/metrics'),
};
