-- Least-privilege roles. Phase 1 Step 4 / Phase 0 §19.
-- kubi_migrator owns the schema and runs migrations.
-- kubi_app is the runtime role: no DDL, no DELETE, no BYPASSRLS.
CREATE ROLE kubi_app LOGIN PASSWORD 'devapp';
CREATE DATABASE kubi_test OWNER kubi_migrator;
