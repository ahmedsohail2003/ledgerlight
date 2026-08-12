-- Complete per-vendor flag table, computed WITHOUT the per-rule row caps.
-- rule_results stores capped example rows (bounded storage for evidence
-- display); this table answers "did rule R fire for vendor V in run X" over
-- the FULL result set, so eval recall/FPR and evidence-pack counts are never
-- a function of which rows happened to fit under a LIMIT.
CREATE TABLE IF NOT EXISTS rule_vendor_flags (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  rule_id VARCHAR(64) NOT NULL,
  severity ENUM('info','low','medium','high') NOT NULL,
  vendor_id BIGINT UNSIGNED NOT NULL,
  finding_count INT UNSIGNED NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_flag (run_id, rule_id, vendor_id),
  KEY idx_flags_vendor (vendor_id),
  KEY idx_flags_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
