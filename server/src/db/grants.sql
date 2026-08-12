-- Least-privilege database identities. Run as a MySQL admin (root), NOT as the
-- app user. Passwords are placeholders — override locally (ALTER USER) or via
-- your secret store; never commit real credentials.
--
--   ledgerlight_admin  : DDL (migrations + ETL reset only)
--   ledgerlight        : per-table DML for the API/ETL. audit_log is
--                        INSERT+SELECT only, so the audit trail is append-only
--                        at the privilege layer, not by convention.
--   ledgerlight_ro     : SELECT only — used by the agent's evidence pool, so
--                        nothing the LLM influences can ever write.
--
-- Every identity exists for 'localhost', '127.0.0.1' AND '%' so the grants
-- bind to the connection identity that is actually in effect: native local
-- MySQL matches the first two; connections that traverse the Docker bridge
-- (compose's published port) or any remote host match '%'. In compose, this
-- file is mounted into /docker-entrypoint-initdb.d and applied automatically
-- on first init (see docker-compose.yml), so the restricted identities are in
-- effect there too — not just documented.
-- Verified by server/test/db-grants.integration.test.ts, which connects as
-- each identity and asserts UPDATE/DELETE on audit_log are denied.

CREATE USER IF NOT EXISTS 'ledgerlight_admin'@'localhost' IDENTIFIED BY 'admin_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_admin'@'127.0.0.1' IDENTIFIED BY 'admin_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_admin'@'%'         IDENTIFIED BY 'admin_dev_change_me';
GRANT ALL PRIVILEGES ON ledgerlight.* TO 'ledgerlight_admin'@'localhost';
GRANT ALL PRIVILEGES ON ledgerlight.* TO 'ledgerlight_admin'@'127.0.0.1';
GRANT ALL PRIVILEGES ON ledgerlight.* TO 'ledgerlight_admin'@'%';

CREATE USER IF NOT EXISTS 'ledgerlight_ro'@'localhost' IDENTIFIED BY 'ro_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_ro'@'127.0.0.1' IDENTIFIED BY 'ro_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_ro'@'%'         IDENTIFIED BY 'ro_dev_change_me';
GRANT SELECT ON ledgerlight.* TO 'ledgerlight_ro'@'localhost';
GRANT SELECT ON ledgerlight.* TO 'ledgerlight_ro'@'127.0.0.1';
GRANT SELECT ON ledgerlight.* TO 'ledgerlight_ro'@'%';

-- The app user may already exist (compose's MYSQL_USER creates
-- 'ledgerlight'@'%' with ALL on the schema); create any missing host variants,
-- then strip every schema privilege before re-granting per-table DML.
-- IF EXISTS / IGNORE UNKNOWN USER (MySQL 8.0.30+) keeps this idempotent and
-- prevents the abort-on-first-error failure mode of piped batch input.
CREATE USER IF NOT EXISTS 'ledgerlight'@'localhost' IDENTIFIED BY 'ledgerlight_dev';
CREATE USER IF NOT EXISTS 'ledgerlight'@'127.0.0.1' IDENTIFIED BY 'ledgerlight_dev';
CREATE USER IF NOT EXISTS 'ledgerlight'@'%'         IDENTIFIED BY 'ledgerlight_dev';
REVOKE IF EXISTS ALL PRIVILEGES ON ledgerlight.* FROM 'ledgerlight'@'localhost' IGNORE UNKNOWN USER;
REVOKE IF EXISTS ALL PRIVILEGES ON ledgerlight.* FROM 'ledgerlight'@'127.0.0.1' IGNORE UNKNOWN USER;
REVOKE IF EXISTS ALL PRIVILEGES ON ledgerlight.* FROM 'ledgerlight'@'%' IGNORE UNKNOWN USER;

GRANT SELECT, INSERT ON ledgerlight.contracts TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT ON ledgerlight.vendors TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT ON ledgerlight.vendor_aliases TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT ON ledgerlight.buyers TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT, UPDATE ON ledgerlight.gold_labels TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT ON ledgerlight.rule_results TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT ON ledgerlight.rule_vendor_flags TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT ON ledgerlight.investigations TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT, UPDATE ON ledgerlight.review_cases TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT, UPDATE ON ledgerlight.users TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT ON ledgerlight.schema_migrations TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
GRANT SELECT, INSERT, UPDATE ON ledgerlight.regulation_chunks TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
-- Append-only: the app can write and read the audit trail but never rewrite it.
GRANT SELECT, INSERT ON ledgerlight.audit_log TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';

FLUSH PRIVILEGES;
