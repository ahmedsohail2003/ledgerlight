/** Shared tokenization + TF-IDF retrieval math for the regulation corpus.
 *  Deterministic and dependency-free — no embedding API needed. */

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'or', 'and', 'for', 'is', 'are', 'be', 'by',
  'on', 'as', 'at', 'with', 'that', 'this', 'any', 'may', 'shall', 'where', 'which',
  'not', 'no', 'it', 'its', 'such', 'under', 'into', 'from', 'has', 'have',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export function termFreq(text: string): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokenize(text)) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

export interface ScoredChunk<T> {
  chunk: T;
  score: number;
}

/**
 * Rank chunks against a query by TF-IDF cosine similarity. IDF is computed
 * across the (small) corpus at query time, so no offline index is needed.
 */
export function rankByTfIdf<T extends { term_freq: Record<string, number> }>(
  query: string,
  chunks: T[],
  topK: number,
): ScoredChunk<T>[] {
  const N = chunks.length || 1;
  const df: Record<string, number> = {};
  for (const c of chunks) for (const term of Object.keys(c.term_freq)) df[term] = (df[term] ?? 0) + 1;
  const idf = (term: string): number => Math.log((N + 1) / ((df[term] ?? 0) + 1)) + 1;

  const qtf = termFreq(query);
  const qvec: Record<string, number> = {};
  for (const [term, f] of Object.entries(qtf)) qvec[term] = f * idf(term);
  const qnorm = Math.sqrt(Object.values(qvec).reduce((s, v) => s + v * v, 0)) || 1;

  const scored = chunks.map((c) => {
    let dot = 0;
    let dnorm = 0;
    for (const [term, f] of Object.entries(c.term_freq)) {
      const w = f * idf(term);
      dnorm += w * w;
      if (qvec[term]) dot += w * qvec[term];
    }
    const denom = (Math.sqrt(dnorm) || 1) * qnorm;
    return { chunk: c, score: dot / denom };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK).filter((s) => s.score > 0);
}
