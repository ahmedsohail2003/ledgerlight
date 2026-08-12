-- Run registry: consumers must only ever read flags from a COMPLETED run.
-- Without this, "latest run" was inferred from the newest flag row, so
-- evidence packs built mid-run saw partial fired-rule sets, and a run in
-- which every rule was dormant silently served the previous run's flags.
CREATE TABLE IF NOT EXISTS rule_runs (
  run_id VARCHAR(64) PRIMARY KEY,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  KEY idx_rule_runs_completed (completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE ON ledgerlight.rule_runs TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%'
