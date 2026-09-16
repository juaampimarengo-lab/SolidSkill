# Solid Skill — Journal / Trade Review Specification (V1)

Checkpoint 006. This is a **conceptual and information-architecture
specification** for the Journal/Trade Review product area described in
`PRODUCT.md`. It defines what the Journal and Trade Review workspaces must
be able to show and why, at a product level. It is not an implementation
plan.

It intentionally contains no database schema, no SQL, no TypeScript
interfaces, and no trade-reconstruction algorithm. See
`TRADE_MODEL_CONCEPTS.md` for the Order/Execution/Position/Trade vocabulary
this document assumes throughout.

## Label legend

Following the discipline established in `TRADEZELLA_REFERENCE.md`:

- **[VERIFIED]** — explicitly supported by current TradeZella public
  documentation.
- **[OBSERVED]** — visible in public/supplied TradeZella UI but not
  explicitly documented.
- **[SOLID SKILL DECISION]** — a product decision Solid Skill is making on
  its own, not a TradeZella fact.

---

## 1. Purpose

The Journal is where a trader reviews individual trades in detail: what
happened (executions, result), what was planned (risk, targets), what
process was followed (strategy, rules, compliance), and what the trader
recorded about it (notes, tags, attachments). It is the record-keeping and
per-trade analysis surface of Solid Skill — the Calendar (`CALENDAR_SPEC.md`)
is the time-based orientation surface that leads into it; Analytics
(`PRODUCT.md`) is the aggregate-pattern surface that consumes its data.

## 2. Reference behavior

**[VERIFIED]** TradeZella's Trade Page has a left/trade-details area (stats,
R-multiple, tags, strategy association, executions, attachments) and a
right/analysis area (trade chart with visible entries/exits, Trade Notes,
Day Notes, running P&L). TradeZella also documents individual buy/sell
executions per trade with viewable/editable detail, multiple profit
targets and stop losses with quantities attached to partial levels, Trade
Risk, Initial Target, Planned R-Multiple, Realized R-Multiple, custom
tags/categories, custom strategies, and screenshots/attachments.

**[VERIFIED]** TradeZella's Daily Journal shows daily stats (Net P&L, Total
Trades, Win Rate, Winners, Losers, Volume, Profit Factor, Commissions,
Gross P&L), notes, detailed trade rows, customizable trade columns, and
tags.

**[SOLID SKILL DECISION]** Solid Skill is not obligated to reproduce every
TradeZella feature. The above is reference material for information
density and workflow shape, not a checklist to fulfill. Where TradeZella's
model conflicts with Solid Skill's absolute rules (`CLAUDE.md`) — most
notably no hardcoded methodology and process/outcome separation — Solid
Skill's rules win without exception.

## 3. Journal information architecture

Two connected workspaces:

1. **Journal (Trade Log)** — a filterable table of Trades, one row per
   Trade (§`TRADE_MODEL_CONCEPTS.md` §4), the primary entry point.
2. **Trade Review** — the detail view for a single selected Trade.

**[SOLID SKILL DECISION]** Whether Trade Review is a dedicated page, a
drawer, or a split view is an explicit open product question — see §13.
This document does not assume any of the three.

The Journal also relates to, without owning:

- **Calendar** (`CALENDAR_SPEC.md`) — a day cell's trades should be
  reachable from Trade Review or vice versa; exact navigation is deferred
  (`CALENDAR_SPEC.md` §14 already flags this as unresolved).
- **Strategy Builder** (`STRATEGY_ENGINE.md`) — a Trade's strategy
  association and Trade Rule Results are read from, never edited within,
  the Journal.
- **Daily/Weekly Review** (`PRODUCT.md`) — a day's trades and a day's
  journal note are related concepts; TradeZella's "Day Notes" (§2) suggests
  a day-level note distinct from a trade-level note. Whether Solid Skill's
  day-level note lives in the Journal, the Calendar day-detail area, or the
  Weekly Review is an open product question — see §13.

## 4. Filtering

**[SOLID SKILL DECISION]** The Journal header must eventually support
filtering the Trade table by:

- Account
- Date / date range
- Instrument
- Direction (long/short)
- Strategy
- Outcome (win/loss/break-even — using the same configurable classification
  `CALENDAR_SPEC.md` §12 requires, not an inline `P&L > 0` check)
- Compliance (e.g., trades where all mandatory rules were respected vs.
  trades with at least one violation)

The exact UI controls (dropdowns, chips, a filter bar, saved filter sets)
are not finalized here. Filters must compose (e.g., account + date range +
strategy simultaneously), since a single-filter-at-a-time model would not
match how a trader actually investigates their history.

## 5. Trade table

**[SOLID SKILL DECISION]** Candidate columns, following the TradeZella
Trade Log/Daily Journal reference in spirit:

- Date
- Time
- Instrument
- Direction
- Qty
- Avg Entry
- Avg Exit
- Net P&L
- R (realized)
- Strategy
- Compliance
- Duration

**[VERIFIED, following TradeZella customizable-columns behavior]** Columns
must eventually be user-configurable (shown/hidden/reordered), and no
column in the candidate list above should be assumed always visible.
Additional columns (gross P&L, commissions, tags, account) are plausible
future additions, not a closed set.

Clicking a trade row opens Trade Review (§6). The exact presentation
(page/drawer/split view) is deferred — see §3 and §13.

## 6. Trade Review

Trade Review is the per-Trade detail workspace. It must eventually be able
to represent every field group below. None of this is a layout spec —
grouping into left/right panels or tabs, per the TradeZella reference
pattern, is a future design decision.

### Identity

- Account
- Source platform (Tradovate / MetaTrader 5)
- Instrument
- Asset class
- Direction (`TRADE_MODEL_CONCEPTS.md` §5 — reconstructed, never inferred
  from the closing execution's side)
- Open timestamp
- Close timestamp
- Duration

### Position / execution

- Initial quantity
- Total quantity / volume
- Average entry
- Average exit
- All executions/fills (§7)
- Scale-in indicator/detail (`TRADE_MODEL_CONCEPTS.md` §6)
- Partial exit indicator/detail (`TRADE_MODEL_CONCEPTS.md` §8)
- Complete-exit marker
- Commissions
- Fees
- Swap, where applicable (MT5/CFD only — never shown as a field for a
  Tradovate futures trade where it has no meaning)

### Result

- Gross P&L
- Net P&L
- Selected representation (following the same global representation-mode
  concept as `CALENDAR_SPEC.md` §10 — $, %, R, ticks/points, or pips
  depending on asset class)
- Points/ticks/pips, when relevant to the instrument
- Planned R (`TRADE_MODEL_CONCEPTS.md` §12)
- Realized R (`TRADE_MODEL_CONCEPTS.md` §13)

### Process

- Strategy
- Exact strategy version (`STRATEGY_ENGINE.md` — historical integrity
  applies; see §8 below)
- Strategy compliance (aggregate)
- Individual rule results (Trade Rule Results, `STRATEGY_ENGINE.md`)
- User-defined tags (§10)
- Trade rating, if Solid Skill later chooses to support one — not decided
  in this checkpoint

### Plan / risk

- Planned stop
- Planned target
- Multiple planned targets, where relevant (with per-target planned
  quantity — following TradeZella's documented multiple-profit-target
  pattern, §2)
- Initial risk (`TRADE_MODEL_CONCEPTS.md` §11)

### Journal

- Trade-specific note
- Attachments/screenshots
- Relation to the day's journal/review entry (see §3's open question on
  where a day-level note lives)

## 7. Executions

**[SOLID SKILL DECISION]** Trade Review must eventually be able to display
every raw/normalized execution belonging to a Trade, each showing:

- Timestamp
- Side (buy/sell)
- Quantity
- Price
- Commission/fee contribution
- Source execution ID (`TRADE_MODEL_CONCEPTS.md` §14)

Per `ARCHITECTURE.md`'s Normalization Layer boundary, broker-specific
fields must never leak into this view: a Tradovate fill and an MT5 deal
must already be normalized into the common execution concept
(`TRADE_MODEL_CONCEPTS.md` §2) before the Journal ever sees them. The
Journal consumes normalized executions only.

## 8. Strategy / process section

A reviewed Trade may be associated with a Strategy, a specific Strategy
Version, and a set of Trade Rule Results, as defined in
`STRATEGY_ENGINE.md`. This document does not duplicate that model. The one
Journal-specific obligation worth restating: **historical integrity is
mandatory** — editing a strategy later must never change what a
previously-reviewed trade shows as its strategy/rule evaluation. Trade
Review always displays the strategy version and rule state that was active
at evaluation time, never the current one.

## 9. Notes / attachments

**[SOLID SKILL DECISION, following the TradeZella Trade Notes/Day Notes/
attachments reference]** A Trade must support a free-text note and zero or
more attachments (e.g., screenshots). Whether a day-level note is a
Journal concept, a Calendar concept, or a Weekly Review concept is an open
question (§3, §13) — this document does not assume Trade Review owns
day-level notes, only trade-level ones.

## 10. Tags

**[SOLID SKILL DECISION]** Tags are entirely user-defined metadata, created
and named by the user, with no fixed application-level vocabulary. Per
`CLAUDE.md` Absolute Rule 2 and `STRATEGY_ENGINE.md`'s fundamental rule,
Solid Skill must never hardcode example tag concepts — such as FOMO,
market condition, timeframe, setup type, or mental state — as first-class
application types. Those are illustrative examples of what a user *might*
create, not application concepts to build.

## 11. Result representations

**[SOLID SKILL DECISION, consistent with `CALENDAR_SPEC.md` §10]** Result
values throughout the Journal (table column, Trade Review Result group)
must respond to the same global representation-mode switcher rather than
maintaining an independent unit choice — $, %, R, ticks/points for
futures, or $, %, R, pips for forex/CFD. No conversion calculation is
defined in this checkpoint.

Net vs. gross must always be distinguishable in the UI, never merged into
a single ambiguous "P&L" figure — this follows directly from
`TRADE_MODEL_CONCEPTS.md` §9's requirement that both be representable.

## 12. Customizable columns

Per §5, the Trade table's columns must be configurable per user, not fixed.
This document does not specify the persistence mechanism for column
preferences (local settings vs. per-account vs. per-workspace) — that is an
implementation decision for whenever the Journal UI is actually built.

## 13. Explicit V1 non-goals

- No Journal UI implementation.
- No SQLite schema or persistence implementation.
- No broker/platform integration implementation (Tradovate, MT5).
- No trade-reconstruction algorithm (grouping executions into Trades).
- No finalized decision on Trade Review's presentation (page vs. drawer vs.
  split view) — see §14.
- No finalized decision on where a day-level note lives.
- No backtesting-adjacent functionality of any kind, per `PRODUCT.md`.
- No causal-language analytics copy — this document defines what data
  Trade Review can show, not how Analytics may interpret it; that
  obligation belongs to the Behavior Analytics Engine per
  `ARCHITECTURE.md`.

## 14. Open product questions

1. Is Trade Review a dedicated page, a drawer over the Journal table, or a
   split view alongside it? (§3, §6)
2. Where does a day-level journal note live — Journal, Calendar day-detail
   (`CALENDAR_SPEC.md` §14), or Weekly Review? (§3, §9)
3. How does a user navigate between a Calendar day cell and the Trade(s)
   that occurred on that day — and back? (§3; mirrors
   `CALENDAR_SPEC.md` §16's own open question on day-detail interaction)
4. Will Solid Skill support a trade rating (e.g., a subjective execution-
   quality score separate from P&L and separate from strategy compliance),
   and if so, is it process data or a third axis alongside outcome and
   process? (§6 Process group)
5. How should a netting-mode position reversal (`TRADE_MODEL_CONCEPTS.md`,
   "Reversal segmentation") be presented in the Journal — as the close of
   one Trade and the open of a new one on the same execution, or some
   other convention? This must be resolved during the future MT5
   integration spike, before trade-reconstruction design is finalized, not
   left implicit.
6. When a Trade spans multiple calendar days (via partial exits realizing
   result on different dates, per `CALENDAR_SPEC.md` §11), does Trade
   Review show a single open/close timestamp pair only, or does it also
   need to surface the per-date realized breakdown directly, rather than
   requiring the user to cross-reference the Calendar?
7. Are multiple planned targets/stops with per-target planned quantity
   (§6 Plan/Risk) entered by the user before the trade, derived from
   platform order data when available, or both — and if both, which one
   is authoritative when they disagree?
8. Does "Realized R" (`TRADE_MODEL_CONCEPTS.md` §13) use net or gross P&L
   as its numerator? This must be decided and stated explicitly wherever R
   is displayed, not left ambiguous per-screen.
