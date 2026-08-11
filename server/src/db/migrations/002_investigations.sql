-- Investigations: one row per agent run over a target. `brief` holds the
-- final validated JSON; `mode` records whether it came from the model or the
-- deterministic fallback so every output is attributable to its source.
CREATE TABLE IF NOT EXISTS investigations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_type ENUM('vendor','buyer','contract') NOT NULL,
  target_ref VARCHAR(512) NOT NULL,
  vendor_id BIGINT UNSIGNED NULL,
  status ENUM('completed','failed') NOT NULL,
  mode ENUM('model','fallback') NOT NULL,
  model_id VARCHAR(64) NULL,
  attempts INT NOT NULL DEFAULT 0,
  validation_failures JSON NOT NULL,
  brief JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_investigations_vendor (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
