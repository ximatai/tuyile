#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v migrator_password="$MIGRATOR_PASSWORD" -v runtime_password="$RUNTIME_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE tuyile_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'migrator_password') \gexec
SELECT format('CREATE ROLE tuyile_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'runtime_password') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA tuyile AUTHORIZATION tuyile_migrator;
GRANT USAGE ON SCHEMA tuyile TO tuyile_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE tuyile_migrator IN SCHEMA tuyile GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO tuyile_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE tuyile_migrator IN SCHEMA tuyile GRANT USAGE ON SEQUENCES TO tuyile_runtime;
SQL
