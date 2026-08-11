/**
 * Evidence-pack assembly. The agent never queries the database itself: it
 * receives this pack, and the grounding validator later verifies every figure
 * it states against these exact values. All queries are parameterized and
 * read-only (run on the SELECT-only pool by callers).
 */
import type { Pool } from 'mysql2/promise';
import { normalizeName } from '../etl/normalize.js';
import { retrieveForRules } from '../rag/retrieve.js';

export interface EvidencePack {
  vendor: { id: number; canonical_name: string } | null;
  profile: {
    contract_count: number;
    total_value: number;
    first_award: string | null;
    last_award: string | null;
    buyer_count: number;
  } | null;
  by_buyer: Array<{ buyer: string; contract_count: number; total_value: number }>;
  top_contracts: Array<{
    contract_id: number;
    buyer: string;
    contract_date: string | null;
    contract_value: number | null;
    description: string | null;
    source_link: string | null;
  }>;
  fired_rules: Array<{
    rule_id: string;
    severity: string;
    findings: number;
    example_evidence: unknown;
  }>;
  gold_context: Array<{ case_id: string; label: string; evidence_summary: string | null }>;
  regulations: Array<{ chunk_id: string; doc: string; section_ref: string; title: string; text: string; source_url: string }>;
  data_coverage_note: string;
}

export async function resolveVendor(pool: Pool, vendorRef: string): Promise<{ id: number; canonical_name: string } | null> {
  const key = normalizeName(vendorRef);
  const [rows] = await pool.query<any[]>(
    `SELECT v.id, v.canonical_name, COUNT(c.id) AS n
     FROM vendors v LEFT JOIN contracts c ON c.vendor_id = v.id
     WHERE v.normalized_key = ? OR v.normalized_key LIKE CONCAT(?, ' %')
        OR v.id = (SELECT a.vendor_id FROM vendor_aliases a WHERE a.normalized_alias = ? LIMIT 1)
     GROUP BY v.id, v.canonical_name ORDER BY n DESC LIMIT 1`,
    [key, key, key],
  );
  return rows.length > 0 ? { id: rows[0].id, canonical_name: rows[0].canonical_name } : null;
}

export async function buildVendorEvidence(pool: Pool, vendorRef: string): Promise<EvidencePack> {
  const vendor = await resolveVendor(pool, vendorRef);
  if (!vendor) {
    return {
      vendor: null, profile: null, by_buyer: [], top_contracts: [], fired_rules: [],
      gold_context: [], regulations: [],
      data_coverage_note: 'Vendor not found in the loaded contract data.',
    };
  }

  const [profileRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS contract_count,
            ROUND(COALESCE(SUM(contract_value), 0), 2) AS total_value,
            MIN(contract_date) AS first_award,
            MAX(contract_date) AS last_award,
            COUNT(DISTINCT buyer_id) AS buyer_count
     FROM contracts WHERE vendor_id = ?`,
    [vendor.id],
  );
  const p = profileRows[0];

  const [byBuyer] = await pool.query<any[]>(
    `SELECT b.name AS buyer, COUNT(*) AS contract_count,
            ROUND(SUM(c.contract_value), 2) AS total_value
     FROM contracts c JOIN buyers b ON b.id = c.buyer_id
     WHERE c.vendor_id = ?
     GROUP BY b.name ORDER BY total_value DESC LIMIT 10`,
    [vendor.id],
  );

  const [topContracts] = await pool.query<any[]>(
    `SELECT c.id AS contract_id, b.name AS buyer,
            DATE_FORMAT(c.contract_date, '%Y-%m-%d') AS contract_date,
            c.contract_value, c.description, c.source_link
     FROM contracts c JOIN buyers b ON b.id = c.buyer_id
     WHERE c.vendor_id = ?
     ORDER BY c.contract_value DESC LIMIT 8`,
    [vendor.id],
  );

  const [firedRules] = await pool.query<any[]>(
    `SELECT r.rule_id, MIN(r.severity) AS severity, COUNT(*) AS findings
     FROM rule_results r
     WHERE r.vendor_id = ?
       AND r.run_id = (SELECT run_id FROM rule_results ORDER BY computed_at DESC LIMIT 1)
     GROUP BY r.rule_id`,
    [vendor.id],
  );
  const fired: EvidencePack['fired_rules'] = [];
  for (const fr of firedRules) {
    const [ex] = await pool.query<any[]>(
      `SELECT evidence FROM rule_results WHERE vendor_id = ? AND rule_id = ? ORDER BY id LIMIT 1`,
      [vendor.id, fr.rule_id],
    );
    // The JSON column round-trips as a string when the insert was pre-stringified;
    // parse so evidence_ref paths can resolve into it.
    let example: unknown = ex.length ? ex[0].evidence : null;
    if (typeof example === 'string') {
      try { example = JSON.parse(example); } catch { /* keep as string */ }
    }
    fired.push({
      rule_id: fr.rule_id, severity: fr.severity, findings: Number(fr.findings),
      example_evidence: example,
    });
  }

  // Gold-set context is provided ONLY as background for the reader; the agent
  // is instructed it is not evidence of wrongdoing in the data itself.
  const [gold] = await pool.query<any[]>(
    `SELECT case_id, label, evidence_summary FROM gold_labels WHERE vendor_id = ?`,
    [vendor.id],
  );

  // Retrieve the regulation clauses relevant to whatever rules fired, so the
  // brief can cite the governing law — and citations are grounded to this set.
  const regChunks = await retrieveForRules(pool, fired.map((r) => r.rule_id));
  const regulations = regChunks.map(({ chunk_id, doc, section_ref, title, text, source_url }) => ({
    chunk_id, doc, section_ref, title, text, source_url,
  }));

  return {
    vendor,
    profile: {
      contract_count: Number(p.contract_count),
      total_value: Number(p.total_value),
      first_award: p.first_award ? String(p.first_award).slice(0, 10) : null,
      last_award: p.last_award ? String(p.last_award).slice(0, 10) : null,
      buyer_count: Number(p.buyer_count),
    },
    by_buyer: byBuyer.map((r) => ({
      buyer: r.buyer, contract_count: Number(r.contract_count), total_value: Number(r.total_value),
    })),
    top_contracts: topContracts.map((r) => ({
      contract_id: Number(r.contract_id), buyer: r.buyer, contract_date: r.contract_date,
      contract_value: r.contract_value === null ? null : Number(r.contract_value),
      description: r.description, source_link: r.source_link,
    })),
    fired_rules: fired,
    gold_context: gold.map((g) => ({
      case_id: g.case_id, label: g.label, evidence_summary: g.evidence_summary,
    })),
    regulations,
    data_coverage_note:
      'Data source: official Proactive Disclosure of Contracts over $10,000 (open.canada.ca), ' +
      'including solicitation procedure, bid counts, and amendment trails. Vendor-name variants ' +
      'are normalized but not fully entity-resolved, so a vendor may appear under more than one ' +
      'spelling; figures reflect the loaded rows only.',
  };
}

/** Resolve an evidence_ref JSON path like "top_contracts[2].contract_value". */
export function resolveEvidenceRef(pack: EvidencePack, ref: string): unknown {
  const parts = ref.match(/[^.[\]]+/g);
  if (!parts) return undefined;
  let cur: any = pack;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[/^\d+$/.test(part) ? Number(part) : part];
  }
  return cur;
}
