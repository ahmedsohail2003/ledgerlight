/**
 * Red-flag indicator library. Definitions follow the Open Contracting
 * Partnership "Red flags in public procurement" guide (2024); each rule cites
 * its OCP-style indicator family.
 *
 * Threshold honesty: values are OCP-guide-informed starting points chosen
 * with the same public scandals the gold set documents in mind — which makes
 * the rule-level eval IN-SAMPLE (labels are independent of the rules, but not
 * of the design process). The eval report discloses this; a held-out case set
 * is the planned fix, not a claimed one.
 */
import type { Rule } from '../engine.js';

export const RULES: Rule[] = [
  {
    id: 'repeat_awards_same_pair',
    title: 'Repeated awards to the same vendor by the same buyer in a 12-month window',
    ocpReference: 'OCP: repeat awards to the same supplier / favouritism family',
    severity: 'medium',
    requires: 'any',
    description:
      'Many separate awards to one vendor from one buyer inside a rolling year can indicate order-splitting or an entrenched incumbent. Threshold: >= :minAwards awards and >= :minTotal total value within any calendar year.',
    sql: `
      SELECT c.vendor_id, c.buyer_id,
             MIN(v.canonical_name) AS vendor,
             MIN(b.name)           AS buyer,
             YEAR(c.contract_date) AS award_year,
             COUNT(*)              AS award_count,
             ROUND(SUM(c.contract_value), 2) AS total_value
      FROM contracts c
      JOIN vendors v ON v.id = c.vendor_id
      JOIN buyers  b ON b.id = c.buyer_id
      WHERE c.contract_date IS NOT NULL
      GROUP BY c.vendor_id, c.buyer_id, YEAR(c.contract_date)
      HAVING COUNT(*) >= :minAwards AND SUM(c.contract_value) >= :minTotal
      ORDER BY award_count DESC
      LIMIT 500`,
    params: { minAwards: 6, minTotal: 1_000_000 },
  },
  {
    id: 'vendor_buyer_concentration',
    title: 'Vendor holds a dominant share of a buyer\'s annual contract spend',
    ocpReference: 'OCP: supplier concentration / market dominance family',
    severity: 'medium',
    requires: 'any',
    description:
      'A single vendor capturing >= :minShare of a buyer\'s annual awarded value (with >= :minTotal at stake and a buyer spending >= :minBuyerTotal) suggests incumbency lock-in worth review.',
    sql: `
      WITH buyer_year AS (
        SELECT buyer_id, YEAR(contract_date) AS y, SUM(contract_value) AS buyer_total
        FROM contracts
        WHERE contract_date IS NOT NULL AND contract_value IS NOT NULL
        GROUP BY buyer_id, YEAR(contract_date)
        HAVING SUM(contract_value) >= :minBuyerTotal
      ),
      pair_year AS (
        SELECT vendor_id, buyer_id, YEAR(contract_date) AS y,
               SUM(contract_value) AS pair_total, COUNT(*) AS award_count
        FROM contracts
        WHERE contract_date IS NOT NULL AND contract_value IS NOT NULL
        GROUP BY vendor_id, buyer_id, YEAR(contract_date)
      )
      SELECT p.vendor_id, p.buyer_id,
             MIN(v.canonical_name) AS vendor,
             MIN(b.name)           AS buyer,
             p.y                   AS award_year,
             p.award_count,
             ROUND(p.pair_total, 2)  AS vendor_total,
             ROUND(y.buyer_total, 2) AS buyer_total,
             ROUND(p.pair_total / y.buyer_total, 3) AS share
      FROM pair_year p
      JOIN buyer_year y ON y.buyer_id = p.buyer_id AND y.y = p.y
      JOIN vendors v ON v.id = p.vendor_id
      JOIN buyers  b ON b.id = p.buyer_id
      WHERE p.pair_total / y.buyer_total >= :minShare AND p.pair_total >= :minTotal
      GROUP BY p.vendor_id, p.buyer_id, p.y, p.award_count, p.pair_total, y.buyer_total
      ORDER BY share DESC
      LIMIT 500`,
    params: { minShare: 0.5, minTotal: 5_000_000, minBuyerTotal: 10_000_000 },
  },
  {
    id: 'split_awards_under_threshold',
    title: 'Clustered same-pair awards just under a competitive threshold',
    ocpReference: 'OCP: threshold manipulation / contract-splitting family',
    severity: 'high',
    requires: 'any',
    description:
      'Two or more awards from one buyer to one vendor within :windowDays days, each within 10% under the :threshold competitive threshold, is the classic splitting pattern (GCR s.6(b) sets the $25k/$40k/$100k sole-source ceilings).',
    sql: `
      SELECT a.vendor_id, a.buyer_id,
             MIN(v.canonical_name) AS vendor,
             MIN(b.name)           AS buyer,
             COUNT(DISTINCT a.id) + 1 AS clustered_awards,
             MIN(a.contract_date)  AS window_start,
             MAX(a.contract_date)  AS window_end,
             ROUND(AVG(a.contract_value), 2) AS avg_value
      FROM contracts a
      JOIN contracts s
        ON s.vendor_id = a.vendor_id AND s.buyer_id = a.buyer_id AND s.id <> a.id
       AND s.contract_date BETWEEN a.contract_date AND DATE_ADD(a.contract_date, INTERVAL :windowDays DAY)
       AND s.contract_value >= :threshold * 0.9 AND s.contract_value < :threshold
      JOIN vendors v ON v.id = a.vendor_id
      JOIN buyers  b ON b.id = a.buyer_id
      WHERE a.contract_value >= :threshold * 0.9 AND a.contract_value < :threshold
        AND a.contract_date IS NOT NULL
      GROUP BY a.vendor_id, a.buyer_id
      ORDER BY clustered_awards DESC
      LIMIT 500`,
    params: { windowDays: 90, threshold: 40_000 },
  },
  {
    id: 'noncompetitive_award',
    title: 'Non-competitive (sole-source) award',
    ocpReference: 'OCP: limited/exceptional procedures family',
    severity: 'low',
    requires: 'pd_official',
    description:
      'solicitation_procedure TN (traditional non-competitive) or AC (ACAN). Common and often legitimate — feeds aggregate indicators rather than standing alone.',
    sql: `
      SELECT c.id AS contract_id, c.vendor_id, c.buyer_id, c.contract_value,
             c.solicitation_procedure, c.limited_tendering_reason
      FROM contracts c
      WHERE c.source = 'pd_official' AND c.solicitation_procedure IN ('TN','AC')
        AND c.contract_value >= :minValue
      LIMIT 5000`,
    params: { minValue: 1_000_000 },
  },
  {
    id: 'single_bid_competitive',
    title: 'Competitive procedure that attracted exactly one bid',
    ocpReference: 'OCP: single bidding — the most-used corruption proxy in the literature',
    severity: 'medium',
    requires: 'pd_official',
    description:
      'number_of_bids = 1 on an openly tendered contract (post-2019 rows where the field is mandatory) suggests specs written for one supplier.',
    sql: `
      SELECT c.id AS contract_id, c.vendor_id, c.buyer_id, c.contract_value,
             c.solicitation_procedure, c.number_of_bids
      FROM contracts c
      WHERE c.source = 'pd_official' AND c.number_of_bids = 1
        AND c.solicitation_procedure IN ('OB','TC','ST')
        AND c.contract_date >= '2019-01-01'
        AND c.contract_value >= :minValue
      LIMIT 5000`,
    params: { minValue: 100_000 },
  },
  {
    id: 'amendment_inflation',
    title: 'Contract value grew far beyond its original award through amendments',
    ocpReference: 'OCP: contract-implementation / renegotiation family (Phoenix/IBM pattern)',
    severity: 'high',
    requires: 'pd_official',
    description:
      'Latest amended total >= :minRatio x the original value (and >= :minValue). Amendments are separate rows (instrument_type=A, contract_value = new total).',
    sql: `
      SELECT c.vendor_id, c.buyer_id, c.procurement_id,
             MAX(c.contract_value)  AS latest_total,
             MIN(c.original_value)  AS original_value,
             ROUND(MAX(c.contract_value) / NULLIF(MIN(c.original_value), 0), 2) AS growth_ratio,
             COUNT(*) - 1           AS amendment_rows
      FROM contracts c
      WHERE c.source = 'pd_official' AND c.procurement_id IS NOT NULL
      GROUP BY c.vendor_id, c.buyer_id, c.procurement_id
      HAVING MIN(c.original_value) > 0
         AND MAX(c.contract_value) >= :minValue
         AND MAX(c.contract_value) / MIN(c.original_value) >= :minRatio
      ORDER BY growth_ratio DESC
      LIMIT 500`,
    params: { minRatio: 3, minValue: 1_000_000 },
  },
];
