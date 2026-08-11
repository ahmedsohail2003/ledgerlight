/**
 * Loads the independently-sourced gold-set cases (OAG/OPO/parliament/
 * suspensions/journalism) into gold_labels and links each named vendor to the
 * vendors table via the curated alias list. Prints a resolution report so we
 * know exactly which cases ground out in real contract rows.
 */
import { readFile } from 'node:fs/promises';
import { getPool, closePool } from '../db/pool.js';
import { config } from '../config.js';
import { normalizeName } from '../etl/normalize.js';
import { CASE_VENDOR_ALIASES } from './aliases.js';

interface GoldCase {
  case_id: string;
  vendor: string;
  buyer: string;
  what: string;
  period: string;
  approx_value: string;
  label: string;
  red_flag_types: string[];
  evidence: { source_type: string; title: string; url: string; finding: string }[];
  matchability_notes: string;
  match?: { match_confidence?: string } | null;
}

const VALID_LABELS = new Set(['problematic', 'alleged', 'clean', 'mixed']);

async function main(): Promise<void> {
  const pool = getPool();
  const casesRaw: GoldCase[] = JSON.parse(await readFile(config.goldset.candidatesPath, 'utf8'));

  // The research file contains near-duplicate cases from different sweeps;
  // keep the first occurrence of each case_id.
  const seen = new Set<string>();
  const cases = casesRaw.filter((c) => {
    if (!c.case_id || seen.has(c.case_id)) return false;
    seen.add(c.case_id);
    return true;
  });

  let linked = 0;
  let unlinked = 0;

  for (const c of cases) {
    const label = VALID_LABELS.has(c.label) ? c.label : 'alleged';

    // Resolve vendor via curated aliases first, falling back to the raw string.
    const aliases = CASE_VENDOR_ALIASES[c.case_id] ?? [c.vendor];
    let vendorId: number | null = null;
    let matchedAlias: string | null = null;
    let rowCount = 0;
    for (const alias of aliases) {
      const key = normalizeName(alias);
      // Prefix match lets "GC STRATEGIES" find "GC STRATEGIES INC" variants
      // that normalization alone doesn't merge (extra descriptive words).
      const [rows] = await pool.query<any[]>(
        `SELECT v.id, v.canonical_name, COUNT(c.id) AS n
         FROM vendors v LEFT JOIN contracts c ON c.vendor_id = v.id
         WHERE v.normalized_key = ? OR v.normalized_key LIKE CONCAT(?, ' %')
         GROUP BY v.id ORDER BY n DESC LIMIT 1`,
        [key, key],
      );
      if (rows.length > 0) {
        vendorId = rows[0].id;
        matchedAlias = alias;
        rowCount = Number(rows[0].n);
        break;
      }
    }

    await pool.query(
      `INSERT INTO gold_labels
        (case_id, label, vendor_id, vendor_name_raw, buyer_scope, period, approx_value,
         red_flag_types, evidence, evidence_summary, match_confidence, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), vendor_id = VALUES(vendor_id)`,
      [
        c.case_id, label, vendorId, c.vendor, c.buyer, c.period, c.approx_value,
        JSON.stringify(c.red_flag_types ?? []),
        JSON.stringify(c.evidence ?? []),
        c.what ?? null,
        c.match?.match_confidence ?? null,
        c.matchability_notes ?? null,
      ],
    );

    if (vendorId !== null) {
      linked += 1;
      // Record the successful alias for future ETL runs.
      await pool.query(
        `INSERT IGNORE INTO vendor_aliases (vendor_id, alias, normalized_alias, source)
         VALUES (?, ?, ?, 'goldset')`,
        [vendorId, matchedAlias, normalizeName(matchedAlias!)],
      );
      console.log(`LINKED   [${label}] ${c.case_id} → vendor#${vendorId} via "${matchedAlias}" (${rowCount} contract rows)`);
    } else {
      unlinked += 1;
      console.log(`UNLINKED [${label}] ${c.case_id} (${c.vendor.slice(0, 60)})`);
    }
  }

  await pool.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`,
    ['goldset:load', 'load', 'gold_labels', 'all',
     JSON.stringify({ cases: cases.length, linked, unlinked })],
  );
  console.log(`done: cases=${cases.length} linked=${linked} unlinked=${unlinked}`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
