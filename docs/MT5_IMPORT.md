# MT5 Import (Checkpoint 012B-2)

The first importer from proven, normalized MT5 lifecycle candidates into Solid
Skill's persisted Account / Trade / Executions. Code:
`src/main/integrations/mt5/import/`. Input: `MT5_NORMALIZATION.md`.

> **READ-ONLY.** The importer receives already-normalized facts. It has no
> connection to MT5 and no code path that could send, modify, cancel or close
> anything. A smoke test scans the module for order/execution capability.

## 1. Purpose

Convert only **COMPLETED + RESOLVED + SUPPORTED** lifecycle candidates into
persisted Trades, idempotently and without ever rewriting history. Open,
unresolved, unsupported, rejected and non-trading facts are **reported, never
persisted**.

## 2. Architecture

```
Raw Deal Receiver -> Raw Staging -> Pure MT5 Normalizer -> MT5 Import Service
                                                             -> Persistence repositories -> SQLite
                                                             -> existing Trading IPC -> Journal / Calendar / Reviews
```

- The normalizer stays pure (no SQLite). The importer owns persistence mapping
  and Solid Skill UUID creation (through `TradeRepository`).
- `Mt5ImportService.import(normalizationResult, { currency, dryRun? })` returns a
  structured `Mt5ImportResult`: `account`, `created`, `alreadyExisting`,
  `conflicts`, `skippedOpen`, `skippedUnresolved`, `skippedUnsupported`,
  `failed`, `ignoredNonTrading`, `rejectedDeals`, `inexactAverages`, `totals`.
- **Normal application flow never calls it.** Only the development CLI, the explicit
  dev-only live-import gate (§14, unpackaged + env opt-in, acts only on a fresh
  confirmed request) and the smoke suite do. `src/main/index.ts` references only the
  gate's env-guarded starter, never the service (smoke-tested).

## 3. Account source identity

`accounts(source_platform = 'MT5', source_account_id = JSON[server, accountLogin])`,
covered by the existing unique index `accounts_source_identity`. Facts only:
never a display name, array index, chart or symbol. The Account is created
lazily (only when there is at least one completed candidate) and reused
afterwards; reconnecting or re-importing never creates a second one.

- Display name: `MT5 · ***514` (last three characters of the login; logins
  shorter than 6 characters are fully masked). Neutral by design: no broker,
  server, or prop-firm inference.
- The full login is stored (it is the source identity) but never printed,
  logged, or put in results/CLI output.
- `timezone` is `NULL` (unknown; the UI presents it as UTC). `currency` is
  supplied by the caller: MT5 reports it (`account.currency`, hello frame), but
  the normalizer's account context and the dev snapshot do not carry it, so it is
  **never guessed**. The live-staging import takes it from the validated hello and
  refuses if absent/invalid; only snapshot tooling needs a manual `--currency`.

## 4. Trade source lifecycle identity — and migration 002

- `trades.source_trade_id` = the normalizer's `sourceLifecycleKey`
  (`JSON["MT5", server, accountLogin, positionId]`), verbatim.
- `trades.source_position_id` = `DEAL_POSITION_ID` (provenance).
- **Migration 002 (`002_trade_source_identity`) was required.** Migration 001
  gave `executions` a unique source identity but only a *non-unique* lookup
  index on `trades.source_trade_id`, so the database could not stop a second
  Trade for the same lifecycle. 002 adds exactly one thing:
  `CREATE UNIQUE INDEX trades_source_identity ON trades (source_platform, account_id, source_trade_id) WHERE source_trade_id IS NOT NULL`.
  No column, no data change; NULL ids (manual trades) are unaffected; migration
  001 is untouched (checksum-locked).
- **Future segmentation:** the uniqueness is on `source_trade_id`, *not* on
  position id. A later netting-reversal segment can use a distinct
  `source_trade_id` (e.g. the key plus a segment discriminator) while
  `source_position_id` stays the same, without rewriting any existing identity.
  No segments are invented for current data.

## 5. Idempotency

Every candidate is looked up by `(MT5, account, sourceLifecycleKey)`:

| Lookup result | Outcome |
| --- | --- |
| no Trade | create Trade + all Executions atomically |
| Trade exists, all source facts equal | `alreadyExisting` (no write) |
| Trade exists, any source fact differs | `conflict` (no write) |
| no Trade, but one of its deals already belongs to another Trade | `conflict` (`executionOwnedByAnotherTrade`) |

Execution identity is `sourceExecutionKey` (`JSON["MT5", server, login, dealTicket]`)
→ `executions.source_execution_id`, unique per platform + account. Replaying the
same deals — in any order — creates 0 Trades and 0 Executions; the database
unique indexes are the backstop if the pre-check were ever bypassed.

## 6. Conflict handling

An existing completed Trade is **never overwritten**. Differences in source
facts (instrument, direction, quantity, open/close time, average prices, gross,
commission, fees, swap, net, and per-execution side/qty/price/time/costs, or the
execution set) are returned as a `conflict` naming the differing facts (not their
values). `analytical_trade_date` is derived, not a source fact, so it is not part
of the comparison (a future date-policy change must be an explicit reconciliation
step, not a silent rewrite). Explicit reconciliation tooling is future work.

## 7. Transaction boundaries

**One transaction per lifecycle** (`Database.transaction`, nested-safe): the
existence check, the Trade and all its Executions commit together or not at all.
A failing lifecycle rolls back alone and appears in `failed` (`WRITE_FAILED`);
siblings and previously imported history are unaffected. Chosen over one batch
transaction because a single malformed lifecycle must never block or roll back
27 good ones, and each lifecycle is independently idempotent so a partial run is
safely resumable by re-running. The Account is created in its own small
transaction first. Candidates that are internally incoherent (quantities not
adding up, costs not equal to the sum of executions, net ≠ gross + costs, closed
before opened, side contradicting direction) are rejected *before* any write
(`INCOHERENT_CANDIDATE`).

## 8. Execution mapping

Each participating normalized execution → one `executions` row, exactly once:
`source_execution_id` = deal identity key, `source_position_id` = position id,
`executed_at` = `DEAL_TIME_MSC` as reported, `side`, `quantity`, `price`,
`commission`/`fees`/`swap` as reported (NULL = not reported). Inserted in
canonical sequence. No synthetic entry/exit executions are created. Per-deal
`profit` has no execution column and lives only at trade level.

## 9. Financial mapping

Fixed-point scale-8 boundary (`fixedPoint.ts`); no floats. Trade fields come
straight from the candidate: `gross_pnl`, `commission`, `fees`, `swap`, `net_pnl`
kept separate (fees are never folded into commission); NULL ≠ 0 is preserved
(smoke-tested at trade and execution level). `TradeRepository` re-validates
`net = gross + commission + fees + swap`. Costs booked as **separate MT5 deals**
(commission/charge deals) have no reliable position link: they are classified
non-trading, counted in `ignoredNonTrading`, and **never attributed to a Trade**.
This sample does not prove every broker's commission representation.
`planned_r`, `realized_r`: NULL (not provided by the source).

## 10. Analytical trading-date policy (V1, temporary)

MT5 supplies `DEAL_TIME_MSC` in **broker server time** and supplies **no
timezone or UTC offset**, so none is invented.

- `opened_at` / `closed_at` are stored as the reported millisecond values.
- `analytical_trade_date` = the calendar date, via explicit **UTC** accessors
  (`toISOString`), of the lifecycle's **opening deal**. Because the reported value is
  server-time-as-epoch, this is the **broker-server calendar date of the open**.
- Never the machine-local timezone (the smoke test asserts the midnight
  boundary at 23:59:59.999 → 00:00:00.000).
- Account `timezone` stays NULL, so the UI shows times as UTC (= server clock).
- Consequences: a broker on GMT+2/+3 rolls its "day" at server midnight, not at
  a trader-meaningful session boundary; Calendar grouping follows this. A
  positions held past midnight is dated by its open. A proper per-account
  trading-timezone / session-boundary setting is a **blocker before automatic
  sync** (§18).

## 11. Symbol preservation

`instrument` = MT5 symbol exactly as reported (`XAUUSD.x` stays `XAUUSD.x`;
`EURUSD.x` is **not** equated with `EURUSD`). A future instrument-normalization
layer may add canonical display names; identity stays source-faithful.

## 12. Strategy null-by-default

Imported Trades have `strategy_version_id = NULL`, no Rule Evaluations, no Trade
Notes, no Day Notes, no planned/realized R. Nothing is inferred from magic
number, symbol, comment, time, broker or EA. Association happens later through
the existing explicit product workflow.

## 13. Open / unresolved / unsupported

| Candidate | Result |
| --- | --- |
| open lifecycle (remaining > 0) | `skippedOpen` (never a completed Trade; not lost from diagnostics) |
| unresolved (missing opening deal, over-close, canceled deal, conflict, …) | `skippedUnresolved` |
| INOUT / OUT_BY / unsupported deal entry | `skippedUnsupported` |
| BALANCE/CREDIT/… and foreign-account deals | `ignoredNonTrading` |
| deals rejected by the normalizer | `rejectedDeals` |

Nothing is silently dropped; no Account is created when nothing is importable.

## 14. Explicit import gate

Normal startup and MT5 reconnect **do not import**. Two sources exist, with
opposite roles:

**Snapshot = QA / dry-run source only.** The dev snapshot (`.dev-data/mt5`)
deliberately pseudonymizes login and server, so importing it would persist an
account identity that can never match the live MT5 account. Snapshot tooling
therefore stays **dry-run** for real captures (`--import` refuses any snapshot
whose identity is pseudonymized; it remains only for synthetic files and needs a
manual `--currency`, since a snapshot carries none):

- `npm run qa:mt5-import` — dry run (default): normalizes the snapshot and
  reports what would happen. Uses a throwaway **copy** of the dev DB (or an empty
  in-memory DB) and `dryRun: true`; the real database is never written.
- `node scripts/mt5-import-qa.mjs --report [--account "***514"]` — read-only
  report on a copy: account (masked), Trade/Execution counts, LONG/SHORT, date
  range, distinct symbols, gross/commission/fees/swap/net, Strategy-assigned count.

**Live receiver staging = authoritative source for the first real write.**

```
real MT5 hello (server, login, currency) + real in-memory staged deals
  -> pure normalizer -> Mt5ImportService -> solid-skill-dev SQLite
```

- Real identity (platform MT5 + server + login) is used **internally**; every
  string that leaves the module (results, logs, summaries, reports) is masked.
- **Currency comes from the validated hello** (`^[A-Z]{3}$`). Missing or invalid
  → the import is refused, never guessed.
- The import is refused unless: the target DB is the dev profile
  (`isDevelopmentDatabasePath`: a `solid-skill-dev` userData dir, a temp path or
  in-memory; the production-named profile is refused), the account is connected,
  its last history sync is **complete**, the accounting mode is known, and (with
  several accounts) one is chosen by masked identity.
- No raw history is persisted; no schema change beyond migration 002.

**The explicit action (dev-only gate).** The running main process polls one fixed
request file, and only when the build is **unpackaged** and
`SOLID_SKILL_MT5_DEV_IMPORT=1` is set (otherwise nothing is watched). No socket,
port, IPC channel or renderer surface exists; a request can only trigger "normalize
current receiver staging and import supported completed lifecycles" into the
already-open dev database. A second receiver is never created.

- Request: `.dev-data/mt5/live-import-request.json`, written by
  `npm run dev:mt5-live-import [-- --account "***514"]`. It must carry the exact
  confirmation token, a fresh timestamp (older than 60 s → discarded unexecuted, so
  a leftover file cannot fire at startup) and is **deleted when read**: one file,
  at most one import.
- Result: `.dev-data/mt5/live-import-result.json` (masked), printed by the CLI:
  account create/reuse, raw deals staged, completed candidates, before/after
  counts, created/already-existing Trades, created Executions, skipped
  open/unresolved/unsupported, ignored non-trading, conflicts, failures, and the
  persisted report.

## 15. Development database behavior

Target: `%APPDATA%\solid-skill-dev\solid-skill.db` (Windows; the same
`solid-skill-dev` userData profile the unpackaged app uses) — never the
production-named `solid-skill` profile. The first real import opens it with
`Database.open`, which applies migration **002** (visible in the CLI output).
Close the app first. The database also contains the seeded demo Account
(`dev-fixture`); the MT5 account is a **separate** Account (different platform +
source identity) and shares no Trades with it (smoke-tested).

**Visibility limitation:** the Journal/Calendar use "the first account with
trades", i.e. the demo account. There is no Accounts UI/selector, and changing
that would be a UI redesign, so this checkpoint deliberately does **not** touch
it. Until an account selector exists, imported MT5 data is verified with
`--report` (counts, LONG/SHORT, dates, symbols, totals, strategy = none) which
reads through the same repositories/`TradingService` read model the UI uses.

## 16. Privacy

Output is counts and masked identity only. Never printed or committed: full
login, server, tickets, raw snapshot, per-trade history. `.dev-data/` is
gitignored; committed tests use synthetic fixtures only. The dev snapshot
already pseudonymizes login and server (see the caveat in §18).

## 17. First-real-import procedure (manual, live)

1. Close any running Solid Skill dev app. Open MetaTrader 5 with the read-only EA
   attached to the real account.
2. From the repo root start the app with the bridge and the dev gate:
   `SOLID_SKILL_MT5_BRIDGE=1 SOLID_SKILL_MT5_DEV_IMPORT=1 npm run dev`
   (PowerShell: `$env:SOLID_SKILL_MT5_BRIDGE='1'; $env:SOLID_SKILL_MT5_DEV_IMPORT='1'; npm run dev`).
3. Wait for the console line `MT5 history sync COMPLETE (***NNN)`.
4. In a second terminal, same folder: `npm run dev:mt5-live-import`. Review the
   summary: account `created`, Trades/Executions created, skips, conflicts (0),
   failures (0), and the report (strategy assigned 0).
5. Replay: run `npm run dev:mt5-live-import` again. Expect `created Trades: 0;
   already-existing Trades: N; created Executions: 0`, account `reused`.
6. Optional: `node scripts/mt5-import-qa.mjs --report --account "***NNN"`.
7. Nothing is committed. The Journal still shows the first account with trades
   (the demo account); the real account is verified through the report (§15).

## 17.1 FIRST REAL IMPORT QA

The first real MT5 write was **explicitly user-triggered** (§14 gate + §17
procedure) against the **`solid-skill-dev` development database only**. The
account identity and currency (USD) came from the live MT5 hello; accounting
mode `RETAIL_HEDGING`. No account login, server identity, tickets or raw history
are recorded here.

**First import**

| Measure | Result |
| --- | --- |
| Raw deals staged / completed candidates | 55 / 27 |
| Before | 0 Trades, 0 Executions |
| Trades / Executions created | 27 / 54 |
| Already-existing Trades | 0 |
| Skipped: open / unresolved / unsupported | 0 / 0 / 0 |
| Non-trading deals ignored | 1 |
| Conflicts / failures | 0 / 0 |
| After | 27 Trades, 54 Executions |

Persisted summary: 18 LONG / 9 SHORT; symbols NAS100.x 8, US30.x 8, XAUUSD.x 5,
EURUSD.x 5, BTCUSD.x 1; dates 2026-09-08 through 2026-09-21.

Financial totals: gross 283.38, commission -68.15, fees 0, swap 2.43,
net 217.66.

Strategy assigned: 0. Rule evaluations: 0. Trade notes: 0. Nothing was
fabricated; strategies, evaluations and notes remain empty.

**Replay** (same explicit import run again): account reused; 55 staged / 27
candidates; before 27 Trades / 54 Executions; created Trades 0, already-existing
Trades 27, created Executions 0, conflicts 0, failures 0; after 27 / 54.
Financial totals and LONG/SHORT counts unchanged.

**Proven on this real sample:** stable source Account identity, stable lifecycle
Trade identity, idempotent import, working Execution deduplication; replay
neither rewrites history nor duplicates Trades or Executions.

**Not proven / not implemented (do not overstate readiness):** automatic import
on reconciliation; live `OnTradeTransaction` → normalize → persist pipeline;
Accounts UI / selector; real scale-in/out sample; real partial-exit sample; real
OUT_BY; real INOUT/netting reversal; broker timezone offset; prop-firm
detection; Tradovate. The Journal still prefers the seeded demo account.

Normal application startup still does **not** auto-import; import only runs
through the explicit gate.

## 18. What remains before automatic sync

**Automatic sync now exists (Checkpoint 012B-4, opt-in, development builds
only): see `MT5_RECONCILIATION.md`.** It reuses this exact importer via
`importFromLiveStaging` — no second Trade importer was built — triggered
after a complete history sync and after each live deal, serialized and
debounced per account. This section's remaining items are what is still open
*after* that checkpoint:

- Snapshots stay dry-run only (their identity is a pseudonym); the live path
  (§14) is the only real-data source.
- Account **currency** now comes from hello; the trading **timezone** is still
  NULL and needs an account setting.
- Session/day-boundary policy for the analytical date (§10).
- Commission-only/charge deals: confirm broker behavior before trusting totals.
- Open-trade support; lifecycles whose opening deal predates the synced window.
- Netting/exchange reversal segmentation and OUT_BY (needs real captures).
- Accounts UI / selector; explicit reconciliation tooling for conflicts; a
  settings/Integrations UI to replace the `SOLID_SKILL_MT5_AUTO_IMPORT`
  environment gate with a real per-account opt-in.
