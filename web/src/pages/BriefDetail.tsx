import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, session, type Brief, type RegulationChunk } from '../api';
import { AssessmentBadge, ClaimRow, ProvenanceLegend } from '../components';

export default function BriefDetail() {
  const { id } = useParams();
  const [data, setData] = useState<{ brief: Brief; mode: string; attempts: number; target_ref: string; created_at: string; rejections: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const [regs, setRegs] = useState<Record<string, RegulationChunk>>({});

  useEffect(() => {
    api.regulations().then((r) => {
      setRegs(Object.fromEntries(r.regulations.map((c) => [c.chunk_id, c])));
    }).catch(() => { /* citations fall back to plain text */ });
  }, []);

  useEffect(() => {
    if (!id) return;
    api.investigation(id)
      .then((r) => {
        const brief: Brief = typeof r.brief === 'string' ? JSON.parse(r.brief) : r.brief;
        const failures = typeof r.validation_failures === 'string'
          ? JSON.parse(r.validation_failures) : r.validation_failures;
        setData({
          brief, mode: r.mode, attempts: r.attempts, target_ref: r.target_ref, created_at: r.created_at,
          rejections: Array.isArray(failures) ? failures.flat().length : 0,
        });
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [id]);

  async function openReview() {
    if (!data || !id) return;
    const r = await api.openReview(`Review brief #${id}: ${data.brief.headline.slice(0, 200)}`, undefined, Number(id));
    setOpened(r.id);
  }

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="sub">Loading…</p>;

  return (
    <div>
      <h1>Integrity brief: {data.target_ref}</h1>
      <div className="card">
        <h2><AssessmentBadge a={data.brief.overall_assessment} /></h2>
        <p><b>{data.brief.headline}</b></p>
        <p className="sub">
          Source: {data.mode === 'model' ? 'LLM — grounding-validated' : 'deterministic fallback (no free-form generation)'}
          {' · '}attempts: {data.attempts} · rejected-draft reasons: {data.rejections}
          {' · '}{new Date(data.created_at).toLocaleString('en-CA')}
        </p>
        <ProvenanceLegend />
        {data.brief.claims.map((c, i) => <ClaimRow claim={c} regs={regs} key={i} />)}
        <p className="sub"><b>Limitations:</b> {data.brief.limitations}</p>
        {session.role === 'analyst' && (
          opened
            ? <div className="banner info">Review case #{opened} opened — see the review board.</div>
            : <button className="primary" onClick={openReview}>Open review case from this brief</button>
        )}
      </div>
    </div>
  );
}
