import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, session, type Brief, type RegulationChunk, type VendorHit } from '../api';
import { AssessmentBadge, ClaimRow, ProvenanceLegend, money } from '../components';

export default function Investigate() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<VendorHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: number; mode: string; attempts: number; brief: Brief } | null>(null);
  const [regs, setRegs] = useState<Record<string, RegulationChunk>>({});

  const isAnalyst = session.role === 'analyst';

  useEffect(() => {
    api.regulations().then((r) => {
      setRegs(Object.fromEntries(r.regulations.map((c) => [c.chunk_id, c])));
    }).catch(() => { /* citations fall back to plain text */ });
  }, []);

  async function search() {
    setError(null); setResult(null);
    if (q.trim().length < 2) { setError('Enter at least 2 characters.'); return; }
    setBusy(true);
    try {
      const r = await api.searchVendors(q.trim());
      setHits(r.vendors);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'search failed');
    } finally { setBusy(false); }
  }

  async function run(vendorName: string) {
    setError(null); setRunning(vendorName); setResult(null);
    try {
      const r = await api.investigate(vendorName);
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'investigation failed');
    } finally { setRunning(null); }
  }

  return (
    <div>
      <h1>Investigate a vendor</h1>
      <div className="card">
        <div className="searchrow">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Search 150,000+ vendors in real federal contract data — try “Coradix”, “Dalian”, “McKinsey”…"
            aria-label="vendor search"
          />
          <button className="primary" onClick={search} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        </div>
        {error && <div className="banner error">{error}</div>}
        {hits && (
          <table className="data">
            <thead>
              <tr><th>Vendor</th><th className="num">Contracts</th><th className="num">Total value</th><th /></tr>
            </thead>
            <tbody>
              {hits.map((v) => (
                <tr key={v.id}>
                  <td>{v.canonical_name}</td>
                  <td className="num">{v.contract_count.toLocaleString('en-CA')}</td>
                  <td className="num">{money(v.total_value)}</td>
                  <td>
                    {isAnalyst ? (
                      <button onClick={() => run(v.canonical_name)} disabled={running !== null}>
                        {running === v.canonical_name ? 'Investigating…' : 'Run investigation'}
                      </button>
                    ) : (
                      <span className="sub">sign in as analyst to run</span>
                    )}
                  </td>
                </tr>
              ))}
              {hits.length === 0 && <tr><td colSpan={4} className="sub">No vendors matched.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {running && (
        <div className="banner info">
          The agent is investigating <b>{running}</b>: assembling the evidence pack, drafting a brief, and
          re-drafting until every figure grounds to a source value…
        </div>
      )}

      {result && (
        <div className="card">
          <h2>Integrity brief · <AssessmentBadge a={result.brief.overall_assessment} /></h2>
          <p><b>{result.brief.headline}</b></p>
          <p className="sub">
            Source: {result.mode === 'model' ? `LLM, grounding-validated (attempts: ${result.attempts})` : 'deterministic fallback'}
            {' · '}<Link to={`/briefs/${result.id}`}>permalink</Link>
          </p>
          <ProvenanceLegend />
          {result.brief.claims.map((c, i) => <ClaimRow claim={c} regs={regs} key={i} />)}
          <p className="sub"><b>Limitations:</b> {result.brief.limitations}</p>
        </div>
      )}
    </div>
  );
}
