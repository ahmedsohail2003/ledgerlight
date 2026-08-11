-- Users: two roles. viewer = public read-only surface; analyst = can open and
-- transition review cases. Passwords are bcrypt hashes, never plaintext.
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('viewer','analyst') NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Review cases: the human-in-the-loop Kanban. A flag becomes "substantiated"
-- only through an analyst decision here; transitions are audit-logged and the
-- verdicts double as independent labels for future evaluation rounds.
CREATE TABLE IF NOT EXISTS review_cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(512) NOT NULL,
  vendor_id BIGINT UNSIGNED NULL,
  investigation_id BIGINT UNSIGNED NULL,
  status ENUM('new','under_review','substantiated','dismissed') NOT NULL DEFAULT 'new',
  opened_by BIGINT UNSIGNED NOT NULL,
  decided_by BIGINT UNSIGNED NULL,
  decision_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_review_status (status),
  KEY idx_review_vendor (vendor_id),
  CONSTRAINT fk_review_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  CONSTRAINT fk_review_investigation FOREIGN KEY (investigation_id) REFERENCES investigations(id),
  CONSTRAINT fk_review_opened_by FOREIGN KEY (opened_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
