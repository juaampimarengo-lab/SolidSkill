# TradeZella — Product Reference Notes

Checkpoint 004. This document studies TradeZella's publicly documented
product structure and publicly visible UI as a **reference** for Solid
Skill's information architecture, workflow shape, and density conventions.

This is not a spec for Solid Skill and not a claim that Solid Skill will
replicate any of this. See `CLAUDE.md`, `PRODUCT.md`, `ARCHITECTURE.md`, and
`STRATEGY_ENGINE.md` for what Solid Skill actually is. Where TradeZella's
model conflicts with Solid Skill's non-negotiable constraints (most notably:
no hardcoded methodology, and process/outcome separation), Solid Skill's
constraints win, full stop — TradeZella is not authoritative over Solid
Skill's design in any area, only informative as prior art.

## Label legend

- **[VERIFIED]** — explicitly stated in TradeZella's public documentation
  (help center / marketing copy describing a named feature).
- **[OBSERVED]** — visible in supplied/public screenshots of TradeZella's UI
  but not explicitly described in documentation text. Treat calculations,
  exact semantics, or edge-case behavior tied to an OBSERVED item as
  unknown unless separately verified.
- **[SOLID SKILL DECISION]** — not a TradeZella fact at all. A product
  choice Solid Skill is making on its own, noted here only because it was
  discussed alongside the TradeZella reference point.

Any item without one of these three labels should not be trusted or acted
on — flag it for follow-up rather than treating it as fact.

---

## 1. Dashboard

- [VERIFIED] TradeZella has a top-level Dashboard summarizing account
  activity and performance.
- [OBSERVED] Dashboard-style screenshots show a mix of summary metric
  blocks and chart widgets (e.g., an equity/P&L curve) laid out in a dense
  grid.
- [SOLID SKILL DECISION] Solid Skill's Dashboard is defined independently
  in `PRODUCT.md` ("top-level view of account health and recent activity")
  and `VISUAL_FOUNDATION.md` §8 (compact analytical block widgets, no hero
  cards). Any dashboard layout work should follow those documents, using
  TradeZella only as a density/organization reference, not a layout source.

## 2. Calendar

- [VERIFIED] TradeZella's **Advanced Calendar** includes: current month
  navigation, monthly total P&L, number of traded days in the month, a
  calendar grid, weekly performance summaries, weekly total net P&L, number
  of traded days per week, the ability to display additional stats, and a
  journal-entry indicator on days that have journal entries.
- [VERIFIED] TradeZella separately has a **Reports → Calendar** area with
  concepts including a yearly calendar, a monthly view, Daily Net
  Cumulative P&L, "Overall Evaluation," and statistics. This is a distinct
  concept from the Advanced Calendar and must not be assumed to be the same
  feature.
- [OBSERVED] Calendar day cells show: day number, daily P&L, trade count, a
  percentage value, a journal/note indicator on some days, and
  positive/negative/neutral visual states.
- [OBSERVED] A right-side weekly column shows, per week: "Week N," a
  weekly result, and a traded-day count.
- Note: the exact calculation behind the OBSERVED percentage field is not
  documented anywhere available to this project and must not be assumed or
  reverse-engineered as fact. See `CALENDAR_SPEC.md` for how Solid Skill
  handles this.

## 3. Trade Journal / Trade Review

- [VERIFIED] TradeZella provides a trade journal / trade log where
  individual trades are recorded and can be annotated.
- [VERIFIED] TradeZella's Trade Page has a left/trade-details area (Stats,
  R-Multiple, Tags, Strategy association, Executions, Attachments) and a
  right/analysis area (trade chart with visible entries/exits, Trade Notes,
  Day Notes, running P&L).
- [VERIFIED] TradeZella documents individual buy/sell executions per trade
  with viewable/editable detail, multiple profit targets and multiple stop
  losses with quantities attached to partial PT/SL levels, Trade Risk,
  Initial Target, Planned R-Multiple, Realized R-Multiple, custom
  tags/categories, custom strategies, and screenshots/attachments.
- [VERIFIED] TradeZella's Trade Log/Daily Journal documentation describes
  daily stats (Net P&L, Total Trades, Win Rate, Winners, Losers, Volume,
  Profit Factor, Commissions, Gross P&L), notes, detailed trade rows,
  customizable trade columns, and tags.
- [OBSERVED] Trade detail views commonly show entry/exit data, P&L,
  screenshots, and free-text notes attached to a trade.
- [SOLID SKILL DECISION] Solid Skill's Trades/Journal area (per
  `PRODUCT.md`) additionally ties each trade to Strategy Engine evaluation
  output (Trade Rule Results) — a concept `STRATEGY_ENGINE.md` defines and
  that is not being asserted as a TradeZella feature.
- [SOLID SKILL DECISION] Solid Skill's Journal/Trade Review model
  (`JOURNAL_SPEC.md`) explicitly distinguishes Order, Execution/Fill,
  Position, and Trade (`TRADE_MODEL_CONCEPTS.md`), and requires that a
  trade's direction be reconstructed from the position lifecycle rather
  than inferred from its closing execution's side. This distinction is not
  claimed as TradeZella product knowledge — it is a Solid Skill
  normalization requirement driven by needing to support both Tradovate
  (fill-level) and MT5 (deal-level) data sources correctly.

## 4. Strategies

- [VERIFIED] TradeZella supports defining and tagging trades against
  user-created strategies/playbooks.
- [OBSERVED] Strategy-related screens show a list of named strategies with
  associated performance stats per strategy.
- [SOLID SKILL DECISION] Solid Skill's Strategy Engine (Strategy → Strategy
  Version → Rule Group → Rule → Condition/Dependency → Trade Rule Result,
  per `STRATEGY_ENGINE.md`) is a materially deeper, fully user-configurable
  model with historical-integrity guarantees. This is a Solid Skill product
  decision, not something being claimed as TradeZella's structure — do not
  treat TradeZella's strategy/playbook feature as evidence for how Solid
  Skill's Strategy Engine internals should work.

## 5. Analytics / Reports

- [VERIFIED] TradeZella has a Reports area covering performance analytics
  across multiple breakdowns (e.g., by symbol, by time, by setup/strategy).
- [OBSERVED] Report screens show chart-heavy breakdowns (win rate, average
  win/loss, P&L by day-of-week, etc.) at high density.
- [SOLID SKILL DECISION] Solid Skill's Behavior Analytics Engine (per
  `ARCHITECTURE.md`) must additionally classify findings as observation /
  emerging pattern / statistically meaningful pattern and must never imply
  causation from correlation. This obligation is a Solid Skill requirement
  with no equivalent claimed for TradeZella.

## 6. Daily process / reviews

- [VERIFIED] TradeZella supports a daily journal entry associated with a
  trading day (referenced by the Advanced Calendar's journal-entry
  indicator).
- [SOLID SKILL DECISION] Solid Skill's Weekly Review (per `PRODUCT.md`,
  Review Engine in `ARCHITECTURE.md`) — structured plan-vs-actual and
  intended-vs-actual-behavior tracking stored longitudinally — is a Solid
  Skill product decision. No equivalent structured weekly-review data model
  is being claimed for TradeZella here.

## 7. Accounts / integrations

- [VERIFIED] TradeZella connects to multiple brokers/platforms to import
  trade data for journaling.
- [SOLID SKILL DECISION] Solid Skill's integration set (Tradovate,
  MetaTrader 5), read-only constraint, and adapter/normalization
  architecture (`ARCHITECTURE.md`) are Solid Skill decisions, independent
  of which platforms TradeZella integrates with or how.

## 8. Prop-firm-related functionality

- [VERIFIED] TradeZella markets prop-firm-oriented tracking features (e.g.,
  evaluation/challenge progress tracking).
- [SOLID SKILL DECISION] Solid Skill's Prop Firm tracking area (evaluation/
  challenge progress, drawdown limits, funded-account rules — per
  `PRODUCT.md`) is defined independently and is not asserted to mirror
  TradeZella's specific implementation or metrics.

---

## Explicit exclusion: backtesting

TradeZella's public materials may reference backtesting-adjacent
functionality in the broader product category. This is **not** documented
here and must never be treated as a Solid Skill target: `PRODUCT.md` states
backtesting is a permanent, non-negotiable non-goal for Solid Skill. Do not
add a "Backtesting" section to this reference document, and do not let any
future TradeZella research introduce backtesting as a feature to emulate.

---

## How to extend this document

When new TradeZella research is done (documentation reading, additional
screenshots), add findings under the matching section above with the
correct label. Never upgrade an [OBSERVED] item to [VERIFIED] without an
actual documentation source, and never let an [OBSERVED] or
[SOLID SKILL DECISION] item get cited elsewhere in the codebase as if it
were a confirmed TradeZella fact.
