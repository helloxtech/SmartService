# Shifa temporary-report API: local validation

The tests use only a task-owned PostgreSQL 17 database over the Unix socket
`/tmp/shifa-local-validation`, port `55439`, database `shifa_validation`. They
never read Cloudflare or Supabase credentials and the test bindings contain
synthetic values only.

From `apps/shifa-api`, on macOS with Homebrew PostgreSQL 17, initialize a new
disposable validation database as follows. Do not point these commands at a
shared database. The test helper is intentionally fixed to this same socket,
port, and database; do not substitute another path.

```sh
PG_BIN="$(brew --prefix postgresql@17)/bin"
PG_ROOT="/tmp/shifa-local-validation"
mkdir -p "$PG_ROOT"
if [ -e "$PG_ROOT/db/PG_VERSION" ]; then
  echo "Reusing existing isolated cluster at $PG_ROOT/db; skipping initdb."
else
  "$PG_BIN/initdb" -D "$PG_ROOT/db" --auth=trust --no-locale
fi
"$PG_BIN/pg_ctl" -D "$PG_ROOT/db" status >/dev/null 2>&1 || \
  "$PG_BIN/pg_ctl" -D "$PG_ROOT/db" -o "-k $PG_ROOT -p 55439" -w start
if ! "$PG_BIN/psql" -h "$PG_ROOT" -p 55439 -d postgres -Atqc \
  "select 1 from pg_database where datname = 'shifa_validation'" | grep -q 1; then
  for ROLE in anon authenticated service_role; do
    "$PG_BIN/psql" -h "$PG_ROOT" -p 55439 -d postgres -Atqc \
      "select 1 from pg_roles where rolname = '$ROLE'" | grep -q 1 || \
      "$PG_BIN/psql" -h "$PG_ROOT" -p 55439 -d postgres -c "create role $ROLE nologin"
  done
  "$PG_BIN/psql" -h "$PG_ROOT" -p 55439 -d postgres -c \
    "alter role service_role bypassrls; grant service_role to \"$USER\""
  "$PG_BIN/createdb" -h "$PG_ROOT" -p 55439 shifa_validation
  "$PG_BIN/psql" -h "$PG_ROOT" -p 55439 -d shifa_validation -v ON_ERROR_STOP=1 \
    -f supabase/migrations/20261029042839_shifa_temporary_reports.sql
fi
pnpm --filter @shifa/api test:local
```

Stop the disposable server with:

```sh
"$PG_BIN/pg_ctl" -D "$PG_ROOT/db" -w stop
```

`pnpm --filter @shifa/api build` first builds `@shifa/web` and then runs a
Cloudflare Worker dry-run. It does not deploy. The real deployment and any
hosted database migration remain intentionally unperformed.

Every API operation deletes expired rows before it runs. The Worker also has a
five-minute cron (`*/5 * * * *`) as a cleanup fallback. Access is denied as
soon as a share expires; physical row deletion happens on the next API call or
scheduled cleanup, rather than being represented as an instantaneous backup
erasure guarantee.

Copy `.dev.vars.example` only to an ignored `.dev.vars` file when using a
local Worker runtime. The example contains names only; never place a real
credential in a tracked file.

`test:local` truncates `shifa_private.requests`, `shifa_private.shares`, and
`shifa_private.rate_limits` before each case. Its helper is hard-wired to the
socket, port, and database named above; it must not be repointed at a shared
or hosted database.

Database integration tests are intentionally opt-in through `test:local`; ordinary workspace tests do not assume this disposable PostgreSQL cluster exists. For the synthetic browser/simulator server, run `pnpm --filter @shifa/api dev:local` from the repository root.
