# 0004 — Postgres 18 replaces SQLite as the database

Date: 2026-07-05
Status: accepted

## Context

v1 locked "SQLite (Drizzle); one file on a volume" as the database decision and explicitly
deferred Postgres to v2+. SQLite was working in production: at this scale (a friend group,
one app instance) it had no functional shortcomings, but it forced a per-runtime driver fork
(`bun:sqlite` in prod / `better-sqlite3` in dev — dev must run Node, see gotcha #2), and
full-text search lived in an FTS5 virtual table wired up with hand-written triggers outside
the Drizzle schema.

The migration is driven by preference, not need: Postgres as the long-term foundation and a
learning goal in its own right. This ADR exists because the move reverses a documented locked
decision and is expensive to undo (data cutover, schema dialect, deploy topology).

## Options considered

1. **Stay on SQLite** — simplest ops (one file), already verified in prod. Rejected by
   explicit product choice, accepting the added operational surface.
2. **Postgres with `bun:sql` in prod + `postgres` in dev** — keeps a zero-dependency prod
   client but preserves the dual-driver fork forever. Re-tested the underlying constraint
   first: Bun 1.3.14 + Nuxt 4.4.8 still drops `/_ws` WebSocket upgrades under `bun --bun
nuxt dev`, so dev cannot move to Bun and the fork would be permanent. Rejected.
3. **Postgres with postgres.js everywhere** — one driver (`postgres` npm package) on both
   Node dev and Bun prod, one Drizzle flavour, deletes the runtime fork. Chosen.

## Decision

- Postgres 18 (`postgres:18-alpine`) runs as a compose service in dev and prod; the app
  connects via `NUXT_DATABASE_URL` using postgres.js on both runtimes.
- Schema moves to `drizzle-orm/pg-core`; timestamps become `timestamptz`.
- FTS5 is replaced by a STORED generated `tsvector` column
  (`to_tsvector('russian', content)`) with a GIN index — Russian stemming, no sync triggers.
- Registration serialization (previously a synchronous SQLite transaction) uses a
  transaction-scoped `pg_advisory_xact_lock`.
- Existing prod data is cut over with a one-shot ETL script
  (`scripts/migrate-sqlite-to-pg.ts`) shipped inside the app image; see docs/DEPLOY.md.

## Consequences

- Backups are no longer "copy one file": use `pg_dump` (documented in docs/DEPLOY.md);
  copying a running Postgres volume is not a valid backup.
- The prod compose stack gains a stateful service and a `pg-data` volume; the app waits on
  its healthcheck. The `postgres:18` image mounts its volume at `/var/lib/postgresql`
  (moved up from `.../data` in 18).
- Search behavior changes from FTS5 bm25 prefix-matching to Russian-stemmed tsquery prefix
  matching ranked by `ts_rank` (e.g. «книга» now matches «книгу»; suppletive forms like
  «найти»/«нашёл» still don't match — same as before).
- `better-sqlite3` and the `'Bun' in globalThis` driver fork are gone; there is exactly one
  DB code path.
- The old SQLite migrations journal is replaced by a fresh Postgres baseline migration;
  pre-cutover deployments must run the ETL, not the migrator, to carry data forward.
