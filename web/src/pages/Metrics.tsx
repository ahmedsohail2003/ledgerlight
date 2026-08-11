import { useEffect, useState } from 'react';
import { api } from '../api';

type MetricsData = Awaited<ReturnType<typeof api.metrics>>;

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

/** Single-series bar list: one hue, direct value labels, hairline tracks. */
function BarList({ rows }: { rows: { name: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div className="row" key={r.name}>
          <div className="name" title={r.name}>{r.name}</div>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <div className="val">{r.value.toLocaleString('en-CA')}</div>
        </div>
      ))}
      {rows.length === 0 && <p className="sub">nothing recorded yet</p>}
    </div>
  );
}

export default function Metrics() {
  const [m, setM] = useState<MetricsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.metrics().then(setM).catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="banner error">{error}</div>;
  if (!m) return <p className="sub">Loading…</p>;

  const modelRuns = m.investigations.find((r) => r.mode === 'model');
  const totalBriefs = m.investigations.reduce((s, r) => s + Number(r.n), 0);

  return (
    <div>
      <h1>Live agent &amp; rule metrics</h1>
      <div className="tiles">
        <div className="tile">
          <div className="label">Hallucinated figures in accepted briefs</div>
          <div className={`value ${m.latest_eval?.agentMetrics?.hallucinated_figure_rate === 0 ? 'good' : ''}`}>
            {pct(m.latest_eval?.agentMetrics?.hallucinated_figure_rate ?? null)}
          </div>
          <div className="hint">
            {m.latest_eval?.agentMetrics
              ? `latest eval audit over ${m.latest_eval.agentMetrics.briefs_total} briefs`
              : 'run npm run eval to audit'}
          </div>
        </div>
        <div className="tile">
          <div className="label">First-try-valid rate (model briefs)</div>
          <div className="value">{pct(m.first_try_valid_rate)}</div>
          <div className="hint">avg attempts: {modelRuns ? Number(modelRuns.avg_attempts).toFixed(1) : '—'}</div>
        </div>
        <div className="tile">
          <div className="label">Fallback rate</div>
          <div className="value">{pct(m.fallback_rate)}</div>
          <div className="hint">failures degrade to deterministic briefs</div>
        </div>
        <div className="tile">
          <div className="label">Briefs produced</div>
          <div className="value">{totalBriefs.toLocaleString('en-CA')}</div>
          <div className="hint">model + fallback, all audit-logged</div>
        </div>
      </div>

      <div className="card">
        <h2>Findings by indicator — latest rule run</h2>
        <BarList rows={m.latest_rule_run.map((r) => ({ name: r.rule_id, value: Number(r.findings) }))} />
      </div>

      <div className="card">
        <h2>Review queue</h2>
        <BarList rows={m.review_queue.map((r) => ({ name: r.status.replace('_', ' '), value: Number(r.n) }))} />
      </div>
    </div>
  );
}
