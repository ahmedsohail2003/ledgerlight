-- Per-table DML for the app identity — applied as a migration because MySQL 8
-- requires tables to exist before table-level grants. Runs on the admin
-- identity, which grants.sql gave WITH GRANT OPTION. The identities themselves
-- are created by server/src/db/grants.sql (bootstrap, auto-applied in compose).
--
-- The deliberate shape: no DDL, no GRANT, and audit_log is INSERT+SELECT only,
-- so the audit trail is append-only at the privilege layer.
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
GRANT SELECT, INSERT ON ledgerlight.audit_log TO 'ledgerlight'@'localhost', 'ledgerlight'@'127.0.0.1', 'ledgerlight'@'%';
-- No FLUSH PRIVILEGES: GRANT statements update the grant tables live, and the
-- admin identity deliberately lacks the global RELOAD privilege.
