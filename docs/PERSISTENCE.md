# Solid Skill — Persistence

Checkpoint 011A. This document describes the local persistence foundation:
how Solid Skill stores data, who owns the database, how the schema evolves,
and where the boundaries are. The schema itself is described in
`DATABASE_SCHEMA.md`. At this checkpoint the renderer still runs on its
existing fixtures; wiring the app to persistence is checkpoint 011B.

## 1. Why local SQLite

Solid Skill is a desktop application whose data is one trader's private
journal: trades, executions, strategies, notes. It needs relational
integrity (trades → executions, trades → strategy versions → rules →
evaluations), transactional writes, and durability across restarts, with no
server and no account. SQLite gives all of that in a single local file. The
historical-integrity rules in `CLAUDE.md` (Absolute Rule 3) are expressed as
foreign keys, unique indexes, and triggers, so the database itself refuses
states that would corrupt history.

## 2. Electron main-process ownership

```
Electron Main Process
        ↓
SQLite (node:sqlite)
        ↓
Repository / Persistence layer   (src/main/persistence)
        ↓
narrow IPC boundary  (later checkpoint)
        ↓
Renderer
```

The database is opened, used, and closed only in the Electron **main**
process. The renderer never opens SQLite and never receives a connection,
SQL, or file path. `src/main/persistence` has no Electron imports, so all
persistence logic runs (and is tested) independent of Electron windows, the
UI, and any broker adapter. Only `src/main/index.ts` knows about Electron
and decides *where* the file lives.

## 3. Selected SQLite implementation: `node:sqlite`

Verified against the actual project runtime, not system Node:

| | |
|---|---|
| Electron | 44.3.0 |
| Embedded Node | 24.20.0 |
| Chromium | 152.0.7977.78 |
| SQLite (via `node:sqlite`) | 3.53.4 |

Probed from the Electron main process: `require('node:sqlite')` loads;
`DatabaseSync` works with `STRICT` tables, `PRAGMA foreign_keys`, WAL mode,
explicit transactions/savepoints, and BigInt reads (`setReadBigInts`), which
exact fixed-point storage needs.

**Why `node:sqlite` over `better-sqlite3`:** it ships inside Electron's Node,
so there is **no native module** to compile, no `electron-rebuild`, no
ABI-mismatch risk on Electron upgrades, and nothing extra to unpack when
packaging. The build keeps `node:sqlite` as an external import.

**Risk to track:** Node documents `node:sqlite` as a young API (its
stability level is below "stable"). It is synchronous, which is acceptable
for a single-user local journal but means large operations should stay short
or be batched inside a transaction. Electron upgrades change the embedded
Node/SQLite version; re-run `npm run smoke:persistence` after each upgrade.
All SQLite access is confined to `sql.ts` and `database.ts`, so swapping the
driver later would not touch repositories' public API.

## 4. Database path

```
<app.getPath('userData')>/solid-skill.db
```

(plus `-wal` / `-shm` sidecar files while open). On Windows this is normally
`%APPDATA%\solid-skill\solid-skill.db`. The database is never inside the Git
repository; `*.db`, `*.db-wal`, `*.db-shm`, `*.db-journal` are gitignored in
case tooling creates one locally. No runtime data is ever seeded: a new user
gets an empty schema.

## 5. Initialization lifecycle

`app.whenReady()` → `initializePersistence()` → `createWindow()`.

1. Open the file (created if absent).
2. `PRAGMA foreign_keys = ON` (verified; open fails if it cannot be enabled),
   `busy_timeout`, and — for file databases — `journal_mode = WAL`,
   `synchronous = NORMAL`.
3. Run pending migrations (§6).
4. Build the repositories.
5. Log one line: path, schema version, journal mode, foreign-key status,
   migrations applied on this start.

If any step fails the partially opened connection is closed, the error is
logged (`[persistence] failed to initialize …`), and the app **continues to
start** on its existing renderer data. The window is never blocked on the
database and there is no recovery UI yet.

## 6. Migrations

- Code lives in `src/main/persistence/migrations/`, registered in order in
  `migrations/index.ts`. Each is `{ version, name, sql }`. SQL is embedded in
  TypeScript so it bundles with the main process without asset handling.
- Versions are sequential from 1 with no gaps; the registry is validated at
  startup.
- History table `schema_migrations(version, name, checksum, applied_at)`.
- Each migration runs in **one transaction together with its history row**:
  it is recorded if and only if it fully applied. A failing migration rolls
  back completely and startup fails safely.
- Already-applied migrations are never re-run (second start applies none).
- Safety checks at startup: a database containing a migration this build does
  not know (created by a newer version) is **refused**; an applied
  migration whose SQL no longer matches its recorded SHA-256 checksum is
  **refused**. Shipped migrations are append-only; fix forward with a new one.
- There is no schema auto-sync and no hand-editing of the database file.
- Adding one: create `002_<name>.ts`, append it to `MIGRATIONS`, add smoke
  coverage. Migrations may change storage representation, never the
  historical meaning of an evaluated Strategy Version.

## 7. Repository boundary

`Database.open(path)` returns an object exposing `repositories` (and
`health`, `close`, `listAppliedMigrations`). No raw connection is exposed.

| Repository | Responsibility |
|---|---|
| `accounts` | create, get, find by source id, list, edit metadata, archive |
| `trades` | create a Trade with its Executions atomically; get/list; list executions; associate a strategy version |
| `strategies` | Strategy identity/metadata, archive |
| `strategyVersions` | Draft lifecycle (create/discard/publish), Groups and Rules (draft only), version definitions |
| `evaluations` | list a trade's evaluations with frozen rule wording; set a rule's state |
| `notes` | Trade note and Day note upserts/reads |

These are small explicit classes over hand-written SQL, not an ORM. SQL does
not appear outside `src/main/persistence`. Records use Decimal strings for
money/price/quantity/R, epoch-ms numbers for timestamps, and `YYYY-MM-DD`
strings for analytical dates.

## 8. Transaction rules

- Any operation that writes more than one row is atomic
  (`Sql.transaction`): `createTrade` (trade + all executions),
  `associateStrategyVersion` (first assignment of a version to a still-unassigned
  trade + one UNREVIEWED evaluation per rule), `createDraft` (draft + copied groups/rules), `publishDraft`,
  `discardDraft`, `removeGroup`.
- The outermost transaction is `BEGIN IMMEDIATE … COMMIT`; nested calls use
  `SAVEPOINT`, so methods compose. Any throw rolls back and rethrows.
- Repository methods do not catch and hide database errors.
- Business rules are enforced twice where they protect history: in the
  repository (clear error messages) and in the schema (triggers / constraints
  / composite foreign keys), so a bug or a direct connection still cannot
  violate them.

## 9. Shutdown behavior

`app.on('will-quit')` closes the database (idempotent, errors logged). A
graceful close checkpoints the WAL; verified by launching and closing the app
twice with no leftover `-wal`/`-shm` files. If the process is killed abruptly,
SQLite's WAL recovery restores a consistent state on the next open.

## 10. Future IPC boundary

A later checkpoint will add a narrow, typed IPC surface in `src/preload`,
exposing **application-level operations** (e.g. "list trades for a date",
"set a rule evaluation"), validated in the main process, backed by these
repositories. It will never expose SQL, file paths, or the connection. Money
crosses that boundary as Decimal strings. This checkpoint deliberately adds
none of it.

## 11. Backup / export (later)

Not implemented. Considerations for later: use SQLite's online backup
(`VACUUM INTO` or the backup API) rather than copying a live file with its
WAL; include the schema version in any export; import must go through the same
migration chain; nothing exported may contain credentials (credentials never
enter this database — Absolute Rule 6).

## 12. Explicit non-goals of this checkpoint

MT5 / Tradovate integration, broker normalization or trade reconstruction,
Analytics tables, Weekly Review, attachments/screenshots, an accounts UI,
credential storage, cloud sync, replacing renderer fixtures, and any recovery
wizard. The database receives *normalized facts*; it does not derive them.

## QA

`npm run smoke:persistence` bundles `src/main/persistence/__smoke__/smoke.ts`
and runs it **inside the Electron main-process runtime** against temporary
databases under the OS temp directory (never the user's database). It covers
first start, reopen, migration safety, repository behavior, historical
integrity, multi-execution and SHORT trades, dedup, and schema-level
immutability. It is development tooling and is not part of the app bundle.
