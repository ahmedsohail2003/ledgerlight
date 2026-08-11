/**
 * Official ETL: loads the Proactive Disclosure "Contracts over $10,000" CSV
 * (open.canada.ca, ~1.3M rows, 43 columns) into the contracts table. This is
 * the authoritative source and it carries the procedure/bid-count/amendment
 * columns that power the full indicator library.
 *
 * Two passes for speed at this scale: pass 1 collects distinct vendors/buyers
 * and bulk-loads them (one round trip per batch, not per row); pass 2 streams
 * the rows and inserts contracts using the in-memory id maps.
 *
 * NOTE: the buying organization lives in owner_org_title — the buyer_name
 * column is empty on ~65% of rows.
 *
 *   OFFICIAL_CSV_PATH=/abs/path/contracts.csv npm run etl:official --workspace @ledgerlight/server
 */
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { getPool, getAdminPool, closePool } from '../db/pool.js';
import { normalizeName, parseMoney, parseDate } from './normalize.js';

const CSV_PATH = process.env.OFFICIAL_CSV_PATH ?? 'data/raw/contracts.csv';
const BATCH = 2000;

function streamRows(): AsyncIterable<Record<string, string>> {
  return createReadStream(CSV_PATH).pipe(
    parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true }),
  ) as unknown as AsyncIterable<Record<string, string>>;
}

async function resetData(): Promise<void> {
  // Maintenance op: TRUNCATE needs DROP, which the least-privilege app user
  // deliberately lacks — run it on the admin connection.
  const admin = getAdminPool();
  await admin.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['review_cases', 'investigations', 'rule_results', 'contracts', 'vendor_aliases', 'vendors', 'buyers']) {
    await admin.query(`TRUNCATE TABLE ${t}`);
  }
  await admin.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function main(): Promise<void> {
  const pool = getPool();
  console.log(`resetting contract data and loading official CSV: ${CSV_PATH}`);
  await resetData();

  // ---- pass 1: distinct vendors + buyers ----
  const vendorKeys = new Map<string, string>(); // normalized -> display name
  const buyerKeys = new Map<string, string>();
  let seen = 0;
  for await (const r of streamRows()) {
    seen += 1;
    const v = (r.vendor_name ?? '').trim();
    // The buying organization is in owner_org_title (buyer_name is usually
    // empty in this dataset); fall back to buyer_name when it isn't.
    const b = (r.owner_org_title || r.buyer_name || '').trim();
    if (v) { const k = normalizeName(v); if (k && !vendorKeys.has(k)) vendorKeys.set(k, v); }
    if (b) { const k = normalizeName(b); if (k && !buyerKeys.has(k)) buyerKeys.set(k, b); }
    if (seen % 200000 === 0) console.log(`  pass1 ${seen} rows · ${vendorKeys.size} vendors · ${buyerKeys.size} buyers`);
  }
  console.log(`pass1 done: ${seen} rows, ${vendorKeys.size} vendors, ${buyerKeys.size} buyers`);

  async function bulkLoad(table: 'vendors' | 'buyers', nameCol: string, entries: Map<string, string>): Promise<Map<string, number>> {
    const rows = [...entries.entries()];
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map(([k, name]) => [name, k]);
      await pool.query(`INSERT IGNORE INTO ${table} (${nameCol}, normalized_key) VALUES ?`, [chunk]);
    }
    const [all] = await pool.query<any[]>(`SELECT id, normalized_key FROM ${table}`);
    const map = new Map<string, number>();
    for (const row of all) map.set(row.normalized_key, row.id);
    return map;
  }

  const vendorIds = await bulkLoad('vendors', 'canonical_name', vendorKeys);
  const buyerIds = await bulkLoad('buyers', 'name', buyerKeys);
  console.log(`loaded ${vendorIds.size} vendors, ${buyerIds.size} buyers`);

  // ---- pass 2: contracts ----
  let read = 0, inserted = 0, skipped = 0;
  let batch: any[][] = [];
  async function flush(): Promise<void> {
    if (!batch.length) return;
    await pool.query(
      `INSERT INTO contracts (source, reference_number, procurement_id, vendor_name, vendor_id,
        buyer_name, buyer_id, contract_date, contract_period_start, delivery_date,
        contract_value, original_value, amendment_value, description, economic_object_code,
        commodity_type, solicitation_procedure, limited_tendering_reason, trade_agreement,
        number_of_bids, former_public_servant, indigenous_business, instrument_type,
        award_criteria, country_of_vendor, raw)
       VALUES ?`,
      [batch],
    );
    inserted += batch.length;
    batch = [];
  }

  for await (const r of streamRows()) {
    read += 1;
    const vName = (r.vendor_name ?? '').trim();
    const bName = (r.owner_org_title || r.buyer_name || '').trim();
    const vId = vName ? vendorIds.get(normalizeName(vName)) : undefined;
    const bId = bName ? buyerIds.get(normalizeName(bName)) : undefined;
    if (!vId || !bId) { skipped += 1; continue; }

    const bids = r.number_of_bids && /^\d+$/.test(r.number_of_bids.trim()) ? Number(r.number_of_bids.trim()) : null;
    batch.push([
      'pd_official', r.reference_number || null, r.procurement_id || null, vName, vId,
      bName, bId, parseDate(r.contract_date), parseDate(r.contract_period_start), parseDate(r.delivery_date),
      parseMoney(r.contract_value), parseMoney(r.original_value), parseMoney(r.amendment_value),
      (r.description_en || '').slice(0, 2000) || null, r.economic_object_code || null,
      r.commodity_type || null, (r.solicitation_procedure || '').trim() || null,
      (r.limited_tendering_reason || '').slice(0, 250) || null, (r.trade_agreement || '').slice(0, 250) || null,
      bids, (r.former_public_servant || '').trim() || null, (r.indigenous_business || '').trim() || null,
      (r.instrument_type || '').trim() || null, (r.award_criteria || '').trim() || null,
      (r.country_of_vendor || '').trim() || null,
      JSON.stringify({ reference_number: r.reference_number, procurement_id: r.procurement_id, owner_org: r.owner_org }),
    ]);
    if (batch.length >= BATCH) await flush();
    if (read % 200000 === 0) console.log(`  pass2 ${read} rows · ${inserted} inserted`);
  }
  await flush();

  await pool.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, 'ingest', 'contracts', 'pd_official', ?)`,
    ['etl:ingest-official', JSON.stringify({ read, inserted, skipped, vendors: vendorIds.size, buyers: buyerIds.size })],
  );
  console.log(`done: read=${read} inserted=${inserted} skipped=${skipped}`);
  await closePool();
}

main().catch((err) => { console.error(err); process.exit(1); });
