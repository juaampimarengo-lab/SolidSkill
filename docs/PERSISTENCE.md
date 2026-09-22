# Solid Skill — Persistence

Checkpoint 011A. This document describes the local persistence foundation:
how Solid Skill stores data, who owns the database, how the schema evolves,
and where the boundaries are. The schema itself is described in
`DATABASE_SCHEMA.md`. **Strategies are persisted and wired (Checkpoint
011B-1); Trades, Executions, Rule Evaluations, Trade Notes and Day Notes are
persisted and wired (Checkpoint 011B-2).** SQLite is the runtime source of
truth for both; the renderer has no trading fixtures (see "Trading (011B-2)"
below).

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
typed IPC handlers + preload API   (src/main/ipc, src/preload)
        ↓
Renderer
```

Renderer → `window.solidSkill` (preload) → typed IPC → main handlers (validate)
→ `StrategyService` / `TradingService` → repositories → SQLite. See
`IPC_CONTRACT.md`.

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
`%APPDATA%\solid-skill\solid-skill.db` for a packaged app. An unpackaged
(development) run uses `%APPDATA%\solid-skill-dev\` instead (see "Development
seed policy"). The database is never inside the Git
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
logged (`[persistence] failed to initialize …`), and the app **still starts**.
The window is never blocked on the database; every Strategy IPC call then
reports `PERSISTENCE_UNAVAILABLE` and the Strategies screen shows an error
state (no fixture fallback). There is no recovery UI yet.

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

## 10. IPC boundary (Strategies and Trading live)

The renderer reaches Strategy data only through the typed API in
`docs/IPC_CONTRACT.md`: application-level operations (list, create, edit
details, archive/restore, begin/edit/discard/publish draft), validated in main,
each one transaction, returning serializable DTOs. Strategy business
operations live in `src/main/strategies/strategyService.ts` (no Electron
imports; tested directly); `src/main/ipc` only validates and maps results.
The renderer's Strategies are loaded through this API; if the database is
unavailable the UI shows an error state, never fixtures. Trading data has its
own `trades` namespace built the same way (011B-2, below). Accounts will get
theirs later; nothing generic (no `query(sql)`) will ever be exposed.

## Development seed policy (strategies)

Demo strategies (Strategy Alpha with v1–v3, Beta v1, Gamma v1 archived) are
useful for visual QA but are **not** production data. `src/main/strategies/devSeed.ts`:

- runs only when `!app.isPackaged` (and can be disabled with
  `SOLID_SKILL_DEV_SEED=0`); a packaged app never seeds;
- runs only when the strategies table is completely empty, so it is idempotent
  and never duplicates Alpha on later launches (re-seeds only if a developer
  empties the table or deletes the dev database);
- writes Strategy data only — no trades, executions, accounts, or evaluations;
- goes through the real repositories (seeded versions are immutable like any
  other) and stamps versions with the seed time, not the fixture dates;
- uses a **separate development data folder**: an unpackaged run sets
  userData to `%APPDATA%solid-skill-dev` (unless `--user-data-dir` is passed
  explicitly), so seeded data can never land in the production-named
  `solid-skill` database.

The renderer fixture that used to mirror this seed (`strategyDummyData.ts`) was
deleted in 011B-2; `devSeed.ts` is the only definition of the demo strategies.

## Trading (011B-2)

Persisted **Trades, Executions, Rule Evaluations, Trade Notes and Day Notes**
are the runtime source of truth for Dashboard (Recent Trades, Calendar
preview), Calendar, Journal, Day Review, canonical Trade Review and Strategies
→ Trades. `journalDummyData`, `calendarDummyData`, `strategyDummyData` and
`getSeedVersion` no longer exist; a persistence failure is a visible error,
never fixtures.

### Layering

```
Renderer hooks (useTrading / useTradeDetail / useDay)
  → window.solidSkill.trades (preload) → typed IPC (validated in main)
  → TradingService (src/main/trading/tradingService.ts, no Electron imports)
  → TradeReadRepository (set-based list read model)
    + Trade / Evaluation / Note / StrategyVersion repositories
  → SQLite
```

No broker, adapter, reconstruction or reconciliation code exists in this path.
Trades and Executions are **normalized facts read as stored**; the only writes
the operations allow are Trade Notes, Day Notes and Rule Evaluation states.

### List vs detail models

- **List** (`trades.list`): one call returns every account plus a
  `TradeSummaryDto` per trade — id, account, analytical date, instrument,
  direction, quantity, open/close timestamps, entry/exit, gross / commission /
  fees / swap / net, planned/realized R, exact strategy identity (`strategyId`,
  `versionId`, `versionNumber`) and the four rule-state counts. No executions or
  per-rule rows. Built from two set-based queries (trades + joins, then a
  `GROUP BY trade, state` count): no N+1. Optional `accountId` / `fromDate` /
  `toDate` are the seam for later filtering and pagination; the current dataset
  is small and returns everything. The renderer loads it **once**
  (`useTrading`) and every summary surface derives from that single Trade
  universe, silently re-reading on section navigation.
- **Detail** (`trades.getDetail`): the summary + chronological Executions + the
  exact saved Strategy Version with the trade's rule results grouped as that
  version defined them + Trade Note + Day Note + same-account, same-day sibling
  summaries. Canonical Trade Review and the Journal quick review use it; one
  call per opened trade.
- **Day** (`trades.getDay`): (account, analytical date) → trades + Day Note.

### Exact Strategy Version association

`trades.strategy_version_id` references the persisted **published Strategy
Version id**; `trade_rule_evaluations` carry the same version id via composite
foreign keys. Rule wording and grouping in Trade Review come from the rule rows
of that version. Nothing at runtime matches by strategy name, seed name or array
position: Strategies → Trades filters the trade list by the stable `strategyId`,
and per-version counts compare `versionId`. Renaming a Strategy changes only the
displayed name (the DTO joins the *current* name); publishing a newer version
never touches existing trades. The temporary 011B-1 name-matching adapter is
gone. (Strategy names are user data and are not versioned, so a historical view
shows the strategy's current name with the historical version's rules.)

### Writes

- `updateTradeNote` / `updateDayNote`: plain text, ≤ 20 000 characters,
  upserted. A Day Note belongs to (account, analytical date) and is the same row
  shown in Day Review and Trade Review. There is **no editing UI yet** (the
  approved screens are read-only); the operations exist and are covered by
  tests and QA.
- `updateRuleEvaluation`: sets PASS / FAIL / N/A / UNREVIEWED for one rule.
  Enforced three ways: the service checks the rule is in the trade's version;
  `EvaluationRepository.setState` requires `evaluation.strategy_version_id =
  trade.strategy_version_id AND rule.strategy_version_id =
  trade.strategy_version_id`; and the schema's composite foreign keys make any
  other combination unrepresentable. Also UI-less for now (the Trade Review
  rule list is read-only).
- Trades and Executions are immutable through this API (executions are also
  trigger-protected). Nothing writes to a broker.

### Analytical date and timestamps

The persisted **analytical trading date** (`YYYY-MM-DD`) is the only grouping
key for Calendar cells, Day Review and sibling trades. The renderer parses it as
text and never converts UTC timestamps to a date. Timestamps (epoch ms) are shown
as wall-clock time in the **account's IANA timezone** via `Intl`, not the
browser's. A trade at 23:30 New York (03:30 UTC the next day) with analytical
date Sep 15 stays on Sep 15 (smoke-tested). "Today" (the Calendar's
current-month marker and initial month) is the only place a local clock is read.

### Financial values

Storage is unchanged (fixed-point INTEGER, scale 10⁻⁸). IPC carries **decimal
strings**, never `BigInt` or floats. The renderer aggregates (day totals, monthly
stats, running P&L) with exact scaled-BigInt arithmetic (`lib/decimal.ts`) and
converts to a JS number only to format or to plot. Gross, commission, fees, swap
and net stay distinct; `null` (unreported) shows as "—" and never becomes zero.
The fixture's single per-execution "fee" is stored as a signed *commission*
(fees/swap NULL); the UI's "Fees / Commission" is the signed sum of the reported
categories.

### No migration 002

The audit of the approved UI against migration 001 found no unrepresented
concept: every displayed field is a column, a join, or derived (outcome,
duration, compliance %, day/month totals). Tags, attachments and the like are not
used by the current UI, so nothing was added. **Migration 001 is unchanged.**

### Migration 002 and MT5 import (012B-2)

Migration 002 (`trade_source_identity`) adds a unique index on `trades (source_platform, account_id, source_trade_id)` (where not NULL) so imports are idempotent at the database level. The earlier "No migration 002" note applied to the 011B-2 UI audit and remains true for that checkpoint. See `MT5_IMPORT.md`: per-lifecycle transactions, conflicts never overwrite history, imported Trades start with no Strategy/evaluations/notes, and the importer is reachable only through an explicit development command.

### Development trading seed policy

`src/main/trading/devSeed.ts` (+ `devSeedData.ts`, the former 17-trade renderer
fixture as data) — development only:

- runs after the strategy seed, only when `!app.isPackaged` and
  `SOLID_SKILL_DEV_SEED != '0'`, into the `solid-skill-dev` (or an explicit
  `--user-data-dir`) database — never a packaged/production database;
- **idempotent by source identity**: the single dev Account (platform
  `dev-fixture`, source id `dev-fixture-account-1`, "Demo Account 50K",
  America/New_York) is the marker; if it exists nothing is written, so restarts
  never duplicate accounts, trades, executions, notes or evaluations;
- **atomic**: one transaction; every referenced demo strategy/version/rule is
  resolved first and the seed is *skipped* (with a log line) rather than
  half-applied if any is missing;
- source ids are plainly fake (`dev-fixture:<key>`), there are no credentials,
  and nothing is named after a real broker or prop firm;
- strategy **names are used once, inside the seed**, only to locate the demo
  strategies while creating rows; the stored link is the persisted version id;
- the golden cases survive: BUY,BUY,SELL,SELL is one LONG trade with four
  executions; SELL-entry / BUY-exit trades are explicit SHORT; profit-with-a-FAIL
  and loss-with-100%-compliance both exist; no trade is dated after 2026-09-16.

### Temporary limitations (until the broker integrations)

- Trades and executions are seeded facts in development only; nothing ingests or
  reconstructs them yet. Open (unclosed) trades are representable but the UI has
  not been exercised with them.
- The break-even threshold is a fixed presentation default (`lib/tradeView.ts`:
  |net| < 10 account-currency units) pending the configurable threshold in
  `CALENDAR_SPEC.md` §12. It is never stored.
- The $ / % / R / PTS selector is still session UI state; no conversion.
- The active account context is "the first account with trades"; there is no
  Accounts UI or selector. The Topbar account pill ("Apex 50K · Tradovate") and
  the Dashboard's Performance / Equity / By-Day / Process / Strategy-preview
  widgets are static placeholders and are not derived from persisted trades (no
  new analytics in this checkpoint).
- A trade with no strategy shows "—" and reads as zero rules (Complete); no
  fixture exercises it.

## Strategy QA

`npm run qa:strategies-restart` (after `npm run build`) launches the real app
against a throwaway user-data dir, drives it over the DevTools protocol, and
closes it gracefully between runs to verify restart persistence end to end
(metadata, draft, publish, version history, create, archive/restore, seed
idempotency, and the persistence-failure error state).

## Trade Media (Checkpoint 014)

Migration 003 adds `trade_media`: metadata only, in SQLite, for Chart
Evidence attached to a Trade or a Day. Image bytes are never a SQLite BLOB —
they live under `userData/media/` as files, addressed by a repository-owned
relative path. See `docs/TRADE_MEDIA.md` for the full storage architecture,
migration detail, capture implementation, and security model.
`smoke:trade-media` covers this layer the same way `smoke:persistence`
covers the rest.

## 11. Backup / export (later)

Not implemented. Considerations for later: use SQLite's online backup
(`VACUUM INTO` or the backup API) rather than copying a live file with its
WAL; include the schema version in any export; import must go through the same
migration chain; nothing exported may contain credentials (credentials never
enter this database — Absolute Rule 6).

## 12. Explicit non-goals of this checkpoint

MT5 / Tradovate integration, broker normalization or trade reconstruction,
Analytics tables, Weekly Review, attachments/screenshots, an accounts UI,
credential storage, cloud sync, and any recovery wizard. The database receives
*normalized facts*; it does not derive them. (Replacing the renderer fixtures was
deferred to 011B-2 and is done there.)

## QA

`npm run qa:trading-restart` (after `npm run build`) launches the real app
against a throwaway user-data dir and closes it gracefully between runs. It
checks baseline load (Journal, Dashboard, Calendar, Day Review, Trade Review and
Strategies → Trades from SQLite), second-start idempotency (row counts
identical), Trade Note / Day Note / rule-state persistence across restart,
Strategy rename and newer-version stability, LONG multi-execution and SHORT
readback in the UI, compliance edge cases through persisted writes, and the
corrupt-database error state. Notes and rule states have no UI yet, so they are
written through the real preload bridge and verified in the UI after restart.

`npm run smoke:persistence` bundles `src/main/persistence/__smoke__/smoke.ts`
and runs it **inside the Electron main-process runtime** against temporary
databases under the OS temp directory (never the user's database). It covers
first start, reopen, migration safety, repository behavior, historical
integrity, multi-execution and SHORT trades, dedup, and schema-level
immutability, plus (011B-2) the trading service and IPC layer, dev-seed
idempotency, rename / new-version stability, rule-write version enforcement,
notes, analytical-date safety, the 4P/1F/2NA/1U compliance edge cases and the
renderer's pure mapping helpers. It is development tooling and is not part of the app bundle.
