-- Least-privilege database identities. Run as a MySQL admin (root), NOT as the
-- app user. Passwords are placeholders — override via session variables or edit
-- locally; never commit real credentials.
--
--   ledgerlight_admin  : DDL (migrations + ETL reset only)
--   ledgerlight        : per-table DML for the API/ETL. audit_log is
--                        INSERT+SELECT only, so the audit trail is append-only
--                        at the privilege layer, not by convention.
--   ledgerlight_ro     : SELECT only — used by the agent's evidence pool, so
--                        nothing the LLM influences can ever write.

CREATE USER IF NOT EXISTS 'ledgerlight_admin'@'localhost' IDENTIFIED BY 'admin_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_admin'@'127.0.0.1' IDENTIFIED BY 'admin_dev_change_me';
GRANT ALL PRIVILEGES ON ledgerlight.* TO 'ledgerlight_admin'@'localhost';
GRANT ALL PRIVILEGES ON ledgerlight.* TO 'ledgerlight_admin'@'127.0.0.1';

CREATE USER IF NOT EXISTS 'ledgerlight_ro'@'localhost' IDENTIFIED BY 'ro_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_ro'@'127.0.0.1' IDENTIFIED BY 'ro_dev_change_me';
GRANT SELECT ON ledgerlight.* TO 'ledgerlight_ro'@'localhost';
GRANT SELECT ON ledgerlight.* TO 'ledgerlight_ro'@'127.0.0.1';

-- Tighten the app user from ALL to per-table DML (no DDL, no GRANT).
REVOKE ALL PRIVILEGES ON ledgerlight.* FROM 'ledgerlight'@'localhost';
REVOKE ALL PRIVILEGES ON ledgerlight.* FROM 'ledgerlight'@'127.0.0.1';

GRANT SELECT, INSERT ON ledgerlight.contracts TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT ON ledgerlight.vendors TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT ON ledgerlight.vendor_aliases TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT ON ledgerlight.buyers TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON ledgerlight.gold_labels TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT ON ledgerlight.rule_results TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT ON ledgerlight.investigations TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON ledgerlight.review_cases TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON ledgerlight.users TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT ON ledgerlight.schema_migrations TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON ledgerlight.regulation_chunks TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';
-- Append-only: the app can write and read the audit trail but never rewrite it.
GRANT SELECT, INSERT ON ledgerlight.audit_log TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1';

FLUSH PRIVILEGES;
