import { useEffect, useState, type DragEvent } from 'react';
import { api, ApiError, session, type ReviewCase } from '../api';

const COLUMNS: { key: ReviewCase['status']; title: string }[] = [
  { key: 'new', title: 'New flags' },
  { key: 'under_review', title: 'Under review' },
  { key: 'substantiated', title: 'Substantiated' },
  { key: 'dismissed', title: 'Dismissed' },
];

const NEEDS_NOTE = new Set(['substantiated', 'dismissed']);

export default function ReviewBoard() {
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ id: number; to: ReviewCase['status'] } | null>(null);
  const [note, setNote] = useState('');
  const isAnalyst = session.role === 'analyst';

  async function refresh() {
    try {
      const r = await api.reviews();
      setCases(r.reviews);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function move(id: number, to: ReviewCase['status'], decisionNote?: string) {
    setError(null);
    try {
      await api.transitionReview(id, to, decisionNote);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function onDrop(e: DragEvent, to: ReviewCase['status']) {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (!id) return;
    if (NEEDS_NOTE.has(to)) {
      setPendingMove({ id, to });
      setNote('');
    } else {
      void move(id, to);
    }
  }

  return (
    <div>
      <h1>Review board</h1>
      <p className="sub">
        A flag becomes “substantiated” only through a human decision with a written justification — the AI never
        concludes on its own. Every move is written to the immutable audit log.
        {!isAnalyst && ' (Read-only: sign in as analyst to work cases.)'}
      </p>
      {error && <div className="banner error">{error}</div>}
      <div className="board">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            className={`col ${dragOver === col.key ? 'dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop(e, col.key)}
          >
            <h3>{col.title} <span>{cases.filter((c) => c.status === col.key).length}</span></h3>
            {cases.filter((c) => c.status === col.key).map((c) => (
              <div
                key={c.id}
                className="case"
                draggable={isAnalyst}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
              >
                <div>{c.title}</div>
                <div className="meta">
                  #{c.id}{c.vendor ? ` · ${c.vendor}` : ''}
                  {c.investigation_id ? ` · brief #${c.investigation_id}` : ''}
                </div>
                {c.decision_note && <div className="note">{c.decision_note}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {pendingMove && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Decision note required</h2>
            <p className="sub">
              Marking case #{pendingMove.id} as <b>{pendingMove.to.replace('_', ' ')}</b> requires a written
              justification. It becomes part of the audit trail.
            </p>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this decision correct?" />
            <div className="actions">
              <button onClick={() => setPendingMove(null)}>Cancel</button>
              <button
                className="primary"
                disabled={!note.trim()}
                onClick={() => { void move(pendingMove.id, pendingMove.to, note.trim()); setPendingMove(null); }}
              >
                Record decision
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
