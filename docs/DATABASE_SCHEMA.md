# Solid Skill — Database Schema (V1 foundation)

Checkpoint 011A. Source of truth for the schema created by migration
`001_initial_core` (`src/main/persistence/migrations/001_initial_core.ts`).
See `PERSISTENCE.md` for runtime, lifecycle, and migration mechanics.

## 1. Entity overview

```
accounts ─┬─< trades ─┬─< executions
          │           ├─< trade_rule_evaluations >── rules
          │           ├─1 trade_notes                  │
          │           └── strategy_version_id ──┐      │
          └─< day_notes                          ▼      │
strategies ─< strategy_versions (DRAFT|PUBLISHED) ─< rule_groups ─< rules
```

Eleven tables: `accounts`, `trades`, `executions`, `strategies`,
`strategy_versions`, `rule_groups`, `rules`, `trade_rule_evaluations`,
`trade_notes`, `day_notes`, and the bookkeeping table `schema_migrations`.
All are `STRICT`. Nothing methodology-specific exists anywhere in the
schema: rule kinds are only the generic engine kinds; every trading concept
is user data in `rules`/`rule_groups` text.

Conventions: ids are opaque TEXT; timestamps are INTEGER epoch
**milliseconds UTC**; analytical dates are TEXT `YYYY-MM-DD` (GLOB-checked);
financial values are fixed-point INTEGER (§13).

## 2. Accounts

A trading account known to Solid Skill. Columns: `id`, `display_name`,
`source_platform` (open text, e.g. `mt5`, `tradovate` — no CHECK, so a new
integration needs no migration), `source_account_id` (nullable),
`currency`, `timezone` (nullable IANA name; not invented when unknown),
`status` `ACTIVE|ARCHIVED` + `archived_at`, `created_at`, `updated_at`.
No credentials, ever. Unique: `(source_platform, source_account_id)` where
the source id is present. `UNIQUE (id, source_platform)` lets trades and
executions prove their platform matches their account's.

## 3. Trades

The normalized analytical Trade. `id`, `account_id`, `source_platform`
(must match the account — composite FK), `source_trade_id`,
`source_position_id` (both nullable), `analytical_trade_date`,
`instrument` (raw text), `direction` `LONG|SHORT`, `quantity`, `opened_at`,
`closed_at` (NULL = still open), `avg_entry_price`, `avg_exit_price`,
`gross_pnl`, `commission`, `fees`, `swap`, `net_pnl`,
`planned_r`, `realized_r` (NULL = not available, never zero),
`strategy_version_id` (nullable FK to one exact version), timestamps.

- **Direction is stored, never derived** from execution sides.
- **Cost model.** Three separate, generic cost categories, all signed P&L
  contributions (a cost is **negative**, a rebate/credit positive):
  `commission` (broker/platform commission), `fees` (all other
  transaction costs a source reports separately, e.g. exchange, clearing,
  or regulatory fees — no broker-specific columns), and `swap`
  (financing/rollover). Each is **nullable: NULL = the source did not
  report it / not applicable**, never an invented zero, so a fee-only or
  totals-only source is stored exactly as supplied. If a source folds
  several categories into one figure, that figure is stored in `commission`
  and `fees` stays NULL; nothing is split or guessed.
- **Net invariant** (checked by the repository whenever `gross_pnl` and
  `net_pnl` are both supplied; a violation is rejected):
  `net_pnl = gross_pnl + commission + fees + swap`, with NULL counting as 0.
- No reconstruction happens here: the database receives normalized facts.
- Deliberately absent (no product need yet): asset class, planned risk
  amount, tags. Each would arrive as a new migration.

## 4. Executions

Immutable normalized fills/deals belonging to exactly one Trade: `id`,
`trade_id`, `account_id`, `source_platform`, `source_execution_id`,
`source_position_id`, `executed_at`, `side` `BUY|SELL`, `quantity`, `price`,
`commission`, `fees`, `swap`, `created_at`. The three cost columns are
optional and nullable with the same sign convention as trades: a source that
supplies only trade-level totals leaves them NULL, and per-execution costs are
never derived by splitting a trade total. Trade-level costs are the source of
truth for the net invariant; they are not required to equal the sum of
execution-level costs. One Trade owns any number of executions
(BUY, BUY, SELL, SELL = one Trade). Composite FK `(trade_id, account_id)`
keeps an execution in its trade's account. Triggers reject any `UPDATE` or
`DELETE`; the repository offers no edit path.

## 5. Strategies

Durable identity/metadata only: `id`, `name`, `description`, `status`
`ACTIVE|ARCHIVED` + `archived_at`, timestamps. Names are presentation data,
not keys, and are not unique. Presentation identity (icon/colour) arrives in
a later migration. Editing metadata never creates a version
(`STRATEGY_ENGINE.md`, presentation vs. logic).

## 6. Strategy Versions / Draft model

One table, `strategy_versions`, holds both states:

| column | Draft | Published |
|---|---|---|
| `state` | `DRAFT` | `PUBLISHED` |
| `version_number` | NULL | 1, 2, 3 … (sequential per strategy) |
| `published_at` | NULL | set |
| `base_version_id` | the published version it was copied from (NULL if none) | kept as lineage |

A CHECK ties these together; `UNIQUE (strategy_id, version_number)` prevents
duplicates; a **partial unique index on `(strategy_id) WHERE state='DRAFT'`**
guarantees at most one Draft per Strategy. Numbers are plain sequential
integers — no semantic versioning.

Lifecycle (repository): `createDraft` copies the latest published structure
with fresh ids (or starts empty); `publishDraft` flips that same row to
`PUBLISHED` and assigns `max+1` in one transaction (the Draft is "consumed" —
it becomes the version, so its groups/rules need no copying); `discardDraft`
deletes a Draft and its content (safe: a Draft has no history).

**Immutability**: triggers reject any `UPDATE`/`DELETE` of a `PUBLISHED`
row, any insert/update/delete of `rule_groups`/`rules` whose version is not
a `DRAFT`, and any change to a version's id, strategy, base, or creation
time. The repository additionally refuses these with clear errors. Trades
and evaluations can only reference `PUBLISHED` versions (a Draft is never
evaluated).

## 7. Rule Groups

`id`, `strategy_version_id`, `name`, `description`, `position`, timestamps.
Belongs to exactly one version. `UNIQUE (strategy_version_id, id)` supports
composite FKs. `position` is a plain ordering (not unique, so reordering
needs no swap dance).

## 8. Rules

`id`, `strategy_version_id`, `rule_group_id`, `title`, `description`,
`kind` `REQUIRED|OPTIONAL|CONDITIONAL`, `position`, timestamps.
`strategy_version_id` is repeated on purpose: the composite FK
`(strategy_version_id, rule_group_id)` proves a rule and its group are in the
same version, and `UNIQUE (strategy_version_id, id)` lets evaluations prove
which version a rule belongs to. Conditions/dependencies between rules are
not modeled yet (a future migration).

## 9. Trade Rule Evaluations

One row per (trade, rule): `id`, `trade_id`, `strategy_version_id`,
`rule_id`, `state` `PASS|FAIL|N/A|UNREVIEWED`, `evaluated_at`, timestamps.

- `UNIQUE (trade_id, rule_id)`.
- **Association lifecycle** (`trades.strategy_version_id`):
  1. *null → exact published version* is allowed, once, through the explicit
     `TradeRepository.associateStrategyVersion` (typical: an imported trade
     is assigned a strategy when the trader reviews it). It creates one
     UNREVIEWED evaluation per rule of that version atomically.
  2. *Any change once set is refused* — version → another version (including
     v3 → v4) and version → null — by the repository and by the
     `trades_version_association_fixed` trigger. Publishing or editing a
     Strategy only ever adds new version rows; it never writes to a trade.
  3. Evaluations always match the trade's current association: the composite
     FK `(trade_id, strategy_version_id)` requires it.
  4. Deliberate re-assignment or clearing of a reviewed trade is a product
     question and is **unsupported in V1**. Recommended if ever needed: an
     explicit, audited operation that keeps the old evaluations as history
     (e.g. a dedicated history table), not an in-place update.
- FK `(trade_id, strategy_version_id) → trades(id, strategy_version_id)`:
  the evaluation's version must be the one the trade recorded.
- FK `(strategy_version_id, rule_id) → rules(strategy_version_id, id)`: the
  rule must belong to exactly that version.
- CHECK `(state='UNREVIEWED') = (evaluated_at IS NULL)`: UNREVIEWED and N/A
  are never conflated; N/A is a recorded judgement with a timestamp.
- Only `state`/`evaluated_at`/`updated_at` may change; a trigger fixes
  trade, version, and rule. Deletion is blocked.
- `associateStrategyVersion` creates every rule's row as `UNREVIEWED`
  atomically. Wording shown for a historical trade is read through the rule
  row the evaluation points at (`EvaluationRepository.listForTrade`), never
  through the strategy's current version.

## 10. Trade Notes

`trade_notes(trade_id PK → trades, body, created_at, updated_at)`. One
plain-text note per trade (upsert). No rich text.

## 11. Day Notes

`day_notes(account_id, trade_date, body, created_at, updated_at)`, primary
key `(account_id, trade_date)`. Keyed by account and **analytical** date. No
Weekly Review tables.

## 12. Stable IDs

Every Solid Skill entity id is an opaque UUID v4 generated in the main
process (`ids.ts`). No id is derived from a name, instrument, timestamp, or
array index. Strategy names are never used as relationship identifiers; the
renderer fixtures' name-based resolution is a fixture workaround and is not
the persistence model. Future relationships use these ids.

## 13. Financial fixed-point representation

- **Persisted:** signed 64-bit INTEGER = value × 10^8 (scale 8), for price,
  quantity, P&L, commission/fee, swap, and R.
- **Why:** exact for futures tick sizes, forex 5-digit prices, fractional
  lots/contracts, and cent P&L; no binary-float rounding can enter history.
  Range ≈ ±92 billion units with 8 decimals, ample for these values. One
  scale for all columns keeps the codec trivial; no decimal library needed.
- **Boundary:** `fixedPoint.ts` converts between INTEGER and canonical
  decimal **strings** (`"20000.25"`, `"-0.5"`). Repositories accept and
  return strings; they never expose JS numbers for money, and SQLite reads
  use BigInt. Input with more than 8 fractional digits, non-numeric text, or
  out-of-range magnitude is **rejected**, not rounded.
- **Renderer:** receives strings; any display formatting or float math for
  charts happens in the renderer as a presentation concern, never written
  back as stored data.
- Timestamps are ms-epoch integers (fit a JS number safely); they are not
  fixed-point.

## 14. Source identifiers

Preserved, never used as primary keys: `accounts.source_platform` /
`source_account_id`; `trades.source_trade_id` / `source_position_id`;
`executions.source_execution_id` / `source_position_id`. All nullable: an id
a platform does not provide is stored as NULL, never invented. Used for
reconciliation, deduplication, and traceability; no reconciliation logic
exists yet.

## 15. Indexes / dedup preparation

- `accounts_source_identity` — unique `(source_platform, source_account_id)`.
- `executions_source_identity` — **unique**
  `(source_platform, account_id, source_execution_id)` where present:
  re-ingesting the same fill fails instead of duplicating (a failed trade
  insert rolls back with all its executions).
- Non-unique lookup indexes on trades' and executions' source position ids
  and on trades' source trade id. They are deliberately **not unique**: one
  source position can legitimately be split into several analytical Trades
  (the open reversal-segmentation question in `TRADE_MODEL_CONCEPTS.md`).
- Access-path indexes: trades by `(account, date)` and by strategy version;
  executions by `(trade, time)`; rules/groups by parent and position;
  evaluations by `(rule, state)`.

## 16. Foreign-key behavior

`PRAGMA foreign_keys = ON` on every connection; verified at open. Every FK
is the default `NO ACTION` (**restrict**): **nothing cascades**. Consequences
(documented, intentional):

- Archiving a strategy or account only sets `status`/`archived_at`.
- Strategies, versions, trades, accounts, executions, and evaluations with
  history cannot be deleted; the FKs, or triggers, refuse it.
- The only destructive operations that exist: discarding a **Draft**
  (deletes that Draft's rules, groups, and row), removing groups/rules from a
  **Draft**, and overwriting a note's text. There is no delete for trades,
  executions, accounts, strategies, published versions, or evaluations.

## 17. Historical integrity rules

1. A Trade references one exact **published** Strategy Version. It may start
   unassigned; the first assignment (null → version) is explicit, and once
   set it is never re-pointed or cleared (trigger + repository).
2. Evaluations are bound to that version and to rules of that version by
   composite FKs; they can change state but not coordinates.
3. Published versions and their groups/rules are immutable (repository +
   triggers). Publishing v2, v3, … never touches v1's rows.
4. Trade → Strategy → "current rules" is not a path in this schema; the only
   route from a trade to rule wording is trade → version → rules.
5. Executions are immutable facts; direction lives on the Trade.
6. Migrations must preserve the meaning of stored history; applied
   migrations are checksum-locked.

## 18. Future migrations

Expected additions, each as a new numbered migration (never by editing 001):
Strategy presentation identity, rule conditions/dependencies, asset class
and planned risk on trades, tags, attachments, Analytics/Weekly Review
tables, and any change to executions' immutability needed by reconciliation
(which must be a deliberate migration with its own justification, not a
silent relaxation). Renaming/retyping a column follows SQLite's
create-copy-swap pattern inside the migration's transaction, with foreign
keys re-verified (`PRAGMA foreign_key_check`).
