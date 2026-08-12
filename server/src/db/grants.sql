-- Least-privilege identity BOOTSTRAP. Run as a MySQL admin (root), NOT as the
-- app user — or let docker-compose apply it automatically on first init (it
-- is mounted into /docker-entrypoint-initdb.d).
--
--   ledgerlight_admin  : DDL (migrations + ETL reset only), WITH GRANT OPTION
--                        so migrations can carry the app user's table grants
--   ledgerlight        : the API/ETL identity. Stripped to USAGE here; its
--                        per-table DML grants live in migration
--                        006_app_grants.sql (MySQL 8 requires tables to exist
--                        before table-level grants, so they are schema, not
--                        bootstrap). audit_log ends up INSERT+SELECT only —
--                        append-only at the privilege layer, not by convention.
--   ledgerlight_ro     : SELECT only — used by the agent's evidence pool, so
--                        nothing the LLM influences can ever write.
--
-- Every identity exists for 'localhost', '127.0.0.1' AND '%' so the grants
-- bind to the connection identity actually in effect: native local MySQL
-- matches the first two; connections traversing the Docker bridge (compose's
-- published port) or any remote host match '%'.
-- Passwords are dev placeholders — override locally (ALTER USER) or via your
-- secret store; never commit real credentials.
-- Verified by server/test/db-grants.integration.test.ts, which connects as
-- each identity and asserts UPDATE/DELETE on audit_log are denied.

CREATE USER IF NOT EXISTS 'ledgerlight_admin'@'localhost' IDENTIFIED BY 'admin_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_admin'@'127.0.0.1' IDENTIFIED BY 'admin_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_admin'@'%'         IDENTIFIED BY 'admin_dev_change_me';
GRANT ALL PRIVILEGES ON ledgerlight.* TO 'ledgerlight_admin'@'localhost' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON ledgerlight.* TO 'ledgerlight_admin'@'127.0.0.1' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON ledgerlight.* TO 'ledgerlight_admin'@'%' WITH GRANT OPTION;

CREATE USER IF NOT EXISTS 'ledgerlight_ro'@'localhost' IDENTIFIED BY 'ro_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_ro'@'127.0.0.1' IDENTIFIED BY 'ro_dev_change_me';
CREATE USER IF NOT EXISTS 'ledgerlight_ro'@'%'         IDENTIFIED BY 'ro_dev_change_me';
GRANT SELECT ON ledgerlight.* TO 'ledgerlight_ro'@'localhost';
GRANT SELECT ON ledgerlight.* TO 'ledgerlight_ro'@'127.0.0.1';
GRANT SELECT ON ledgerlight.* TO 'ledgerlight_ro'@'%';

-- The app user may already exist (compose's MYSQL_USER creates
-- 'ledgerlight'@'%' with ALL on the schema); create any missing host variants,
-- then strip every schema-level privilege. Its per-table DML comes back in
-- migration 006_app_grants.sql. IF EXISTS / IGNORE UNKNOWN USER (MySQL
-- 8.0.30+) keeps this idempotent instead of aborting piped batch input.
CREATE USER IF NOT EXISTS 'ledgerlight'@'localhost' IDENTIFIED BY 'ledgerlight_dev';
CREATE USER IF NOT EXISTS 'ledgerlight'@'127.0.0.1' IDENTIFIED BY 'ledgerlight_dev';
CREATE USER IF NOT EXISTS 'ledgerlight'@'%'         IDENTIFIED BY 'ledgerlight_dev';
REVOKE IF EXISTS ALL PRIVILEGES ON ledgerlight.* FROM 'ledgerlight'@'localhost' IGNORE UNKNOWN USER;
REVOKE IF EXISTS ALL PRIVILEGES ON ledgerlight.* FROM 'ledgerlight'@'127.0.0.1' IGNORE UNKNOWN USER;
REVOKE IF EXISTS ALL PRIVILEGES ON ledgerlight.* FROM 'ledgerlight'@'%' IGNORE UNKNOWN USER;

FLUSH PRIVILEGES;
