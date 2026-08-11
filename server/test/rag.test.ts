import { describe, expect, it } from 'vitest';
import { tokenize, termFreq, rankByTfIdf } from '../src/rag/text.js';

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops stopwords and short tokens', () => {
    expect(tokenize('The contracting authority MAY, without soliciting bids...'))
      .toEqual(['contracting', 'authority', 'without', 'soliciting', 'bids']);
  });
});

describe('rankByTfIdf', () => {
  const chunks = [
    { chunk_id: 'GCR-s5', term_freq: termFreq('Before any contract the contracting authority shall solicit bids') },
    { chunk_id: 'GCR-s6', term_freq: termFreq('a contracting authority may enter into a contract without soliciting bids where pressing emergency sole source') },
    { chunk_id: 'GCR-s8', term_freq: termFreq('security deposits bid bond') },
  ];

  it('ranks the sole-source clause top for a non-competitive query', () => {
    const out = rankByTfIdf('contract without soliciting bids sole source non-competitive exception', chunks, 2);
    expect(out[0]!.chunk.chunk_id).toBe('GCR-s6');
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('returns nothing for a query with no term overlap', () => {
    const out = rankByTfIdf('zzz qqq', chunks, 3);
    expect(out.length).toBe(0);
  });
});
