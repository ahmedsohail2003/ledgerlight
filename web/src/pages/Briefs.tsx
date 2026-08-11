import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type InvestigationRow } from '../api';

export default function Briefs() {
  const [rows, setRows] = useState<InvestigationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.investigations().then((r) => setRows(r.investigations)).catch((e) => setError(String(e.message ?? e)));
  }, []);

  return (
    <div>
      <h1>Integrity briefs</h1>
      <div className="card">
        {error && <div className="banner error">{error}</div>}
        <table className="data">
          <thead>
            <tr><th>#</th><th>Target</th><th>Source</th><th className="num">Attempts</th><th>When</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/briefs/${r.id}`}>{r.id}</Link></td>
                <td><Link to={`/briefs/${r.id}`}>{r.target_ref}</Link></td>
                <td>{r.mode === 'model' ? 'LLM (grounding-validated)' : 'deterministic fallback'}</td>
                <td className="num">{r.attempts}</td>
                <td className="sub">{new Date(r.created_at).toLocaleString('en-CA')}</td>
              </tr>
            ))}
            {rows.length === 0 && !error && <tr><td colSpan={5} className="sub">No investigations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
