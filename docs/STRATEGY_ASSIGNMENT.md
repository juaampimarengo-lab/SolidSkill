# Solid Skill — Strategy Assignment and Strategy List Order

Checkpoint 015B. Two workflow gaps found in real user QA:

1. A Trade with no Strategy (`strategy_version_id IS NULL`, e.g. every
   imported MT5 Trade) showed "not associated with a strategy" in Trade
   Review with no way to continue.
2. The Strategies list could not be reordered.

This document records how both are solved and the decisions behind them. It
builds on `STRATEGY_VERSIONING.md` (versions, historical integrity),
`STRATEGY_BUILDER_SPEC.md` §9–§14 (evaluation states, compliance, the one
Trade ↔ one Version relationship) and `DATABASE_SCHEMA.md`.

No trading methodology is modelled here. Strategy, Group and Rule names in
every example are user data.

---

## 1. What is assigned: an exact published Version

A Trade is associated with **one exact published Strategy Version**, never
with a Strategy in the abstract (`STRATEGY_VERSIONING.md` §2, §9). The
association reuses the existing column `trades.strategy_version_id`
(migration 001). No new or competing association model was added.

- The caller names the version id. The service never resolves "the current
  version" on the user's behalf. A Strategy id, an unknown id or a Draft id is
  refused (`NOT_FOUND` / `RULE_VIOLATION`).
- The current version is only the **default selection** in the picker. What
  is written is exactly the version shown as selected when the user clicks
  Assign. If a newer version is published while the picker is open, the
  Trade still gets the selected one.
- Publishing a newer version later never moves a Trade. The schema has no path
  from a Trade to "the current rules" (`DATABASE_SCHEMA.md` §17.4).

## 2. One-time assignment (V1)

Assignment is allowed only while `strategy_version_id IS NULL`. Once set, the
association is permanent in V1:

- `TradingService.assignStrategyVersion` refuses an assigned Trade with
  `CONFLICT`;
- `TradeRepository.associateStrategyVersion` refuses it too;
- the migration-001 trigger `trades_version_association_fixed` refuses any
  re-pointing even through a direct connection.

The UI offers **Assign Strategy** only on an unassigned Trade. An assigned
Trade shows its exact Strategy · Version with no "Change Strategy" action.
Reassignment is **not** built. It would need its own design for what happens
to recorded evaluations, which must never silently change
(`CLAUDE.md` Absolute Rule 3).

## 3. Transaction and initial evaluations

One transaction (`TradeRepository.associateStrategyVersion`, wrapped by the
service transaction):

1. set `trades.strategy_version_id` (and the row's `updated_at`);
2. insert one `trade_rule_evaluations` row per rule of **that** version, state
   `UNREVIEWED`, `evaluated_at` NULL.

Both succeed or neither does. The composite foreign key
`trade_rule_evaluations (trade_id, strategy_version_id) → trades` forces the
order (association first) and binds every row to that version.
`UNIQUE (trade_id, rule_id)` makes duplicates impossible.
`smoke:strategy-assignment` injects a failure at the second evaluation insert
and proves the Trade stays unassigned with zero evaluation rows.

No state is fabricated. Nothing is PASS / FAIL / N/A until the trader says so.
Nothing is inferred from P&L or broker facts, and nothing is marked N/A by
conditional applicability (not built; §7). UNREVIEWED is not N/A
(`STRATEGY_BUILDER_SPEC.md` §9).

## 4. What assignment may change

Only `trades.strategy_version_id` (plus that row's `updated_at` modification
timestamp) and new `trade_rule_evaluations` rows. It never changes direction,
instrument, quantity, prices, P&L, commission, fees, swap, source ids,
analytical date, executions, Trade media, Trade Notes or Day Notes. Both the
smoke suite and the real-app QA assert this against a serialized copy of
every fact column.

Assignment addresses a globally unique Trade id and never reads or writes the
active account. Assigning while reviewing an MT5 Trade returns to Journal on
the MT5 account.

## 5. Picker: current, historical and archived versions

Trade Review → Strategy → **Assign Strategy** opens a compact dialog:

- **Strategy**: every Strategy with at least one published version, in the
  user's list order. A never-published Strategy (Draft only) cannot be
  assigned (`STRATEGY_VERSIONING.md` §8).
- **Strategy Version**: that Strategy's published versions, newest first,
  labelled `Current` or `Historical`, each with its rule count and publish
  date. The current version is preselected. Choosing a historical version shows
  "A newer version (vN) exists. Choose the version this Trade actually
  followed." A historical Trade must be reviewable against what actually
  applied then, not re-read through today's rules.
- **Confirmation** (always visible once a version is selected):
  "Assign *Strategy Alpha · v2* to this Trade? This creates 4 UNREVIEWED
  evaluations for the rules in v2. The assignment cannot be changed later."
  Then [Cancel] [Assign].

**Archived Strategies — decision.** Archived Strategies are **hidden by
default** and reachable through a quiet "Show archived Strategies" toggle, where
they are marked *Archived*. Their published versions remain assignable.
Archiving is a presentation/lifecycle state (`STRATEGY_VERSIONING.md` §7, §10),
and a Trade reviewed late may genuinely have followed a methodology the trader
has since retired. Assigning to an archived Strategy's version does not restore
the Strategy. This refines `STRATEGY_VERSIONING.md` §10 ("removes it from
active workflows (e.g. pickers)"): removed from the *default* view, not made
unreachable.

The Journal quick preview stays read-only. For an unassigned Trade it points
to the full Trade Review, where the action lives.

## 6. Reviewing after assignment

The Strategy tab refreshes from persisted data right away. It shows the
Strategy name, the version badge, the version's Groups and Rules, compliance
and review completeness, all UNREVIEWED at first.

Each Rule has a compact segmented control: `PASS` · `FAIL` · `N/A` · `◌`
(reset to UNREVIEWED). It calls the **existing** `trades.updateRuleEvaluation`
path. That path was already implemented and validated in main (rule must
belong to the Trade's own version) but had no UI until now; there is no second
evaluation system. After each confirmed write the detail is re-read.

Compliance is unchanged: PASS / (PASS + FAIL), N/A and UNREVIEWED excluded,
any UNREVIEWED ⇒ Review Incomplete, and P&L never affects it
(`src/shared/compliance.ts`).

## 7. Weekly Review and achievements

Nothing Weekly-Review-specific is written. `ReviewService.getWeek` already
recomputes a week from `trades` and `trade_rule_evaluations`, so a newly
assigned and reviewed Trade appears in process metrics, rule review (grouped by
its exact version), progress bars and the achievements *All Trades Reviewed*,
*No FAIL Recorded* and *Clean Process Week* with no extra code path. The
overlay's Back already bumps Weekly Review's revision so it re-reads.

## 8. Strategy list order (presentation metadata)

Migration 006 adds `strategies.display_position`: the Strategy's place in the
Strategies list. It is **presentation metadata on the Strategy identity**, like
its name (`STRATEGY_VERSIONING.md` §7). It is not versioned and not part of a
Draft, and nothing that evaluates a Trade reads it. Reordering never creates a
Draft or Version, never touches Groups, Rules, Trades or evaluations, and does
not bump `updated_at`.

Model:

- Positions are dense `0..n-1` **within each lifecycle section** (Active,
  Archived). `UNIQUE (status, display_position)` means two strategies can never
  share a slot. Ties in reads are broken by `created_at, id` anyway.
- Migration 006 backfills each section in its previous effective order
  (`created_at, id`), so upgrading changes nothing visible.
- **Create** → end of Active.
- **Archive** → end of Archived; Active is compacted.
- **Restore** → end of Active; Archived is compacted.
- **Delete** (never-published only) → its section is compacted.
- **Move** (`strategies.move({strategyId, toIndex})`) → moves within the
  strategy's own section. An index outside the section is refused
  (`RULE_VIOLATION`), so the top cannot go higher and the bottom cannot go
  lower. It returns the whole list.

Every write is one transaction. Rows are rewritten in two phases (parked above
an offset, then set) because SQLite checks the unique index row by row.

UI: rows show a subtle grip on hover and are draggable **within their section
only**. A drop into the other section is refused, so dragging never archives
or restores; Archive / Restore stay explicit. A restrained `⋯` menu on each
row offers **Move up** / **Move down** (disabled at the ends) as the
keyboard/non-pointer path.

## 9. Future boundary: conditions and dependencies

Not implemented. A Rule's kind (`Required` / `Optional` / `Conditional`) still
does not affect compliance. Nothing decides applicability automatically. When
a scenario a Group describes did not occur, the trader marks those Rules N/A.

A later checkpoint will introduce **generic** context variables, conditions,
dependencies and conditional Group applicability as user-defined structure.
Nothing in this checkpoint hardcodes any methodology concept or pre-empts that
design. Initial evaluations are plain UNREVIEWED rows, so later conditional
logic can be layered on without migrating these rows' meaning.

## 10. QA

- `npm run smoke:strategy-assignment`: temporary databases. Covers the
  assignment matrix (exact version, UNREVIEWED rows, rollback, refusals,
  historical / archived versions, newer publish, evaluation states,
  compliance, Weekly Review + achievements read-through, historical facts,
  active account), migration 006 upgrade, and the ordering matrix
  (deterministic default, move, limits, create / archive / restore / delete,
  uniqueness at the DB level, restart, a 200-operation fuzz). Also covers IPC
  validation of both new channels.
- `npm run qa:strategy-assignment` (after `npm run build`): the real app
  against a **throwaway copy** of the dev database. It reorders via menu and
  drag/drop, refuses a cross-section drop, restarts, and assigns a
  *historical* version of a generic dev-seed Strategy to an MT5 Trade **in the
  copy**. It then sets PASS / FAIL / N/A, checks compliance and Weekly Review,
  restarts again, checks integrity, and verifies the real dev database file is
  byte-identical afterwards. No automated test assigns anything in the real
  database.
