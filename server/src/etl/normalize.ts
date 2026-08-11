/**
 * Vendor/buyer name normalization. The same supplier appears in the data as
 * e.g. "GC Strategies Inc.", "GCSTRATEGIES INCORPORATED", "GC Strategies
 * Incorporated" — normalization produces a stable key so aliases resolve to
 * one vendor row. Kept deliberately conservative: we only strip decoration
 * (case, accents, punctuation, legal suffixes), never fuzzy-match, so a key
 * collision always means a genuinely identical name.
 */

const LEGAL_SUFFIXES = new Set([
  'INC', 'INCORPORATED', 'INCORPOREE', 'LTD', 'LIMITED', 'LTEE', 'LLP', 'LP',
  'CORP', 'CORPORATION', 'CO', 'COMPANY', 'ULC', 'PLC', 'SENC', 'SENCRL',
  'GMBH', 'SARL', 'SA', 'AG', 'BV', 'NV',
]);

export function normalizeName(name: string): string {
  let s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = s.split(' ');
  while (words.length > 1) {
    const last = words[words.length - 1]!;
    if (LEGAL_SUFFIXES.has(last)) words.pop();
    else break;
  }
  return words.join(' ');
}

/** Parse "$1,234,567.89", "1234567", "24399" → number (dollars) or null. */
export function parseMoney(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse ISO-ish dates ("2022-11-22") → 'YYYY-MM-DD' or null. Rejects the
 *  sentinel junk years (1899/9999) known to exist in the source data. */
export function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1990 || year > 2100) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
