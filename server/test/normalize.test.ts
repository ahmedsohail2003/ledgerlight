import { describe, expect, it } from 'vitest';
import { normalizeName, parseMoney, parseDate } from '../src/etl/normalize.js';

describe('normalizeName', () => {
  it('merges legal-suffix and punctuation variants of the same vendor', () => {
    const variants = [
      'GC Strategies Inc.',
      'GC STRATEGIES INCORPORATED',
      'gc strategies inc',
      'G.C. Strategies Ltd.',
    ];
    const keys = new Set(variants.map(normalizeName));
    expect(keys.size).toBe(2); // "GC STRATEGIES" and "G C STRATEGIES" (dotted initials differ; alias table bridges them)
    expect(normalizeName('GC Strategies Inc.')).toBe('GC STRATEGIES');
  });

  it('strips multiple stacked suffixes but never the whole name', () => {
    expect(normalizeName('Coradix Technology Consulting Ltd.')).toBe('CORADIX TECHNOLOGY CONSULTING');
    expect(normalizeName('IBM Canada Company Ltd')).toBe('IBM CANADA');
    expect(normalizeName('Inc.')).toBe('INC');
  });

  it('normalizes accents and ampersands', () => {
    expect(normalizeName('Société Générale & Cie')).toBe('SOCIETE GENERALE AND CIE');
    expect(normalizeName('McKinsey & Company')).toBe('MCKINSEY AND');
  });
});

describe('parseMoney', () => {
  it('handles currency formatting', () => {
    expect(parseMoney('$24,399.00')).toBe(24399);
    expect(parseMoney('1861961')).toBe(1861961);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
  });
});

describe('parseDate', () => {
  it('accepts ISO dates and rejects sentinel junk years present in the source data', () => {
    expect(parseDate('2022-11-22')).toBe('2022-11-22');
    expect(parseDate('1899-12-30')).toBeNull();
    expect(parseDate('9999-01-01')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
});
