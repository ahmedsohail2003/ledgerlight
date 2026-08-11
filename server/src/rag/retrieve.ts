/** retrieve_regulation tool: given the indicators that fired for a target,
 *  build a query and return the most relevant regulation clauses (verbatim,
 *  with stable chunk_ids). Deterministic lexical retrieval — no embeddings. */
import type { Pool } from 'mysql2/promise';
import { rankByTfIdf } from './text.js';

export interface RegulationChunk {
  chunk_id: string;
  doc: string;
  section_ref: string;
  title: string;
  text: string;
  source_url: string;
  term_freq: Record<string, number>;
}

// What each indicator is "about", in the regulation's vocabulary. Fired rules
// contribute their phrase to the retrieval query, so the clauses returned match
// what the data actually flagged.
const RULE_QUERY: Record<string, string> = {
  noncompetitive_award: 'contract without soliciting bids exception sole source non-competitive pressing emergency',
  single_bid_competitive: 'solicit bids competitive manner one bid received',
  split_awards_under_threshold: 'estimated expenditure does not exceed goods contract threshold splitting',
  vendor_buyer_concentration: 'solicit bids competitive contracting authority',
  repeat_awards_same_pair: 'solicit bids exception repeated contracts',
  amendment_inflation: 'contract amendment original value increase',
};

export async function loadAllChunks(pool: Pool): Promise<RegulationChunk[]> {
  const [rows] = await pool.query<any[]>('SELECT chunk_id, doc, section_ref, title, text, source_url, term_freq FROM regulation_chunks');
  return rows.map((r) => ({
    ...r,
    term_freq: typeof r.term_freq === 'string' ? JSON.parse(r.term_freq) : r.term_freq,
  }));
}

export async function retrieveForRules(pool: Pool, firedRuleIds: string[], topK = 3): Promise<RegulationChunk[]> {
  const chunks = await loadAllChunks(pool);
  if (chunks.length === 0) return [];
  const query = firedRuleIds.map((r) => RULE_QUERY[r] ?? r).join(' ')
    || 'solicit bids competitive contracting authority exception';
  return rankByTfIdf(query, chunks, topK).map((s) => s.chunk);
}
