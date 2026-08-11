-- Ledgerlight core schema.
-- The contracts table is aligned to the official Proactive Disclosure
-- "Contracts over $10,000" 43-column layout (ckanext-canada contracts.yaml).
-- `source` records provenance and `raw` preserves original-row identifiers so
-- every downstream claim can be traced back to source records.

CREATE TABLE IF NOT EXISTS vendors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  canonical_name VARCHAR(512) NOT NULL,
  normalized_key VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_vendors_normalized (normalized_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS vendor_aliases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vendor_id BIGINT UNSIGNED NOT NULL,
  alias VARCHAR(512) NOT NULL,
  normalized_alias VARCHAR(255) NOT NULL,
  source ENUM('dataset','goldset','manual') NOT NULL,
  UNIQUE KEY uq_alias_normalized (normalized_alias),
  CONSTRAINT fk_alias_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS buyers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(512) NOT NULL,
  normalized_key VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_buyers_normalized (normalized_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS contracts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source ENUM('pd_official','ijf_mirror','canadabuys') NOT NULL,
  region VARCHAR(64) NULL,
  reference_number VARCHAR(255) NULL,
  procurement_id VARCHAR(255) NULL,
  vendor_name VARCHAR(512) NOT NULL,
  vendor_id BIGINT UNSIGNED NOT NULL,
  buyer_name VARCHAR(512) NOT NULL,
  buyer_id BIGINT UNSIGNED NOT NULL,
  contract_date DATE NULL,
  contract_period_start DATE NULL,
  delivery_date DATE NULL,
  contract_value DECIMAL(15,2) NULL,
  original_value DECIMAL(15,2) NULL,
  amendment_value DECIMAL(15,2) NULL,
  description TEXT NULL,
  economic_object_code VARCHAR(32) NULL,
  commodity_type VARCHAR(64) NULL,
  -- Official code list: AC (ACAN), OB (open bidding), ST (selective tendering),
  -- TC (traditional competitive), TN (traditional non-competitive).
  solicitation_procedure VARCHAR(8) NULL,
  limited_tendering_reason VARCHAR(255) NULL,
  trade_agreement VARCHAR(255) NULL,
  number_of_bids INT NULL,
  former_public_servant VARCHAR(8) NULL,
  indigenous_business VARCHAR(16) NULL,
  -- C = original contract, A = amendment (amendments are separate rows in the
  -- official data; contract_value on an A row is the NEW TOTAL value).
  instrument_type CHAR(4) NULL,
  award_criteria VARCHAR(8) NULL,
  country_of_vendor VARCHAR(8) NULL,
  source_link VARCHAR(1024) NULL,
  raw JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contracts_vendor (vendor_id),
  KEY idx_contracts_buyer (buyer_id),
  KEY idx_contracts_vendor_buyer (vendor_id, buyer_id),
  KEY idx_contracts_date (contract_date),
  KEY idx_contracts_value (contract_value),
  KEY idx_contracts_procedure (solicitation_procedure),
  CONSTRAINT fk_contracts_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  CONSTRAINT fk_contracts_buyer FOREIGN KEY (buyer_id) REFERENCES buyers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Independent ground-truth labels (OAG/OPO/parliament/suspensions/journalism).
-- NEVER derived from rule_results: that would make evaluation circular.
CREATE TABLE IF NOT EXISTS gold_labels (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id VARCHAR(128) NOT NULL,
  label ENUM('problematic','alleged','clean','mixed') NOT NULL,
  vendor_id BIGINT UNSIGNED NULL,
  vendor_name_raw VARCHAR(512) NOT NULL,
  buyer_scope VARCHAR(512) NOT NULL,
  period VARCHAR(255) NULL,
  approx_value VARCHAR(255) NULL,
  red_flag_types JSON NOT NULL,
  evidence JSON NOT NULL,
  evidence_summary TEXT NULL,
  match_confidence VARCHAR(32) NULL,
  notes TEXT NULL,
  UNIQUE KEY uq_gold_case (case_id),
  CONSTRAINT fk_gold_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rule_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  rule_id VARCHAR(64) NOT NULL,
  severity ENUM('info','low','medium','high') NOT NULL,
  vendor_id BIGINT UNSIGNED NULL,
  buyer_id BIGINT UNSIGNED NULL,
  contract_id BIGINT UNSIGNED NULL,
  evidence JSON NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_results_run (run_id),
  KEY idx_results_rule (rule_id),
  KEY idx_results_vendor (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Append-only trail of every system decision and human action.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(128) NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity VARCHAR(64) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  detail JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
