# Solid Skill — Calendar Specification (V1)

Checkpoint 004. This is a **conceptual and information-architecture
specification** for the Calendar product area described in `PRODUCT.md`.
It defines what the Calendar must be able to show and why, at a product
level. It is not an implementation plan.

It intentionally contains:
- No CSS or visual values (those live in `VISUAL_FOUNDATION.md` §10 and
  will be revisited when Calendar is actually built).
- No React/component structure.
- No database schema.

Calendar implementation itself is out of scope for this checkpoint. This
document exists so that when implementation begins, it starts from an
explicit shared understanding rather than generic trading-journal
assumptions.

See `TRADEZELLA_REFERENCE.md` §2 for the reference material this
specification draws from, with VERIFIED/OBSERVED/SOLID SKILL DECISION
labels preserved below wherever a claim traces back to that document.

---

## 1. Purpose

The Calendar gives a trader a time-based view of trading activity and
outcomes, organized by day and by week, so patterns in *when* they trade
and *how they perform* by day/week become visible at a glance. It is a
navigation and orientation surface first — a way to spot a day worth
opening in the Journal — not a full analytics surface (that role belongs to
Analytics).

## 2. Reference behavior

**[VERIFIED — TradeZella Advanced Calendar]**: current month navigation,
monthly total P&L, number of traded days in the month, a calendar grid,
weekly performance summaries (weekly total net P&L, traded-day count per
week), the ability to display additional stats, and a journal-entry
indicator on days with journal entries.

**[VERIFIED — TradeZella Reports → Calendar]**: a separate concept
(yearly calendar, monthly view, Daily Net Cumulative P&L, "Overall
Evaluation," statistics) that Solid Skill V1 does **not** adopt and must
not be conflated with the Calendar Workspace defined below. If Solid Skill
ever wants a yearly/cumulative reporting calendar, that is a distinct,
future, explicitly-scoped product decision — not part of this spec.

**[OBSERVED]**: day cells showing day number, daily P&L, trade count, a
percentage value, a journal/note indicator on some days, and
positive/negative/neutral visual states; a right-side weekly column
showing "Week N," weekly result, and traded-day count. The exact
calculation behind the percentage value is undocumented and is not carried
into this spec as a defined Solid Skill calculation.

## 3. Information hierarchy

From most to least prominent:

1. Month context (which month, monthly result, monthly traded-day count).
2. The grid itself (each day's outcome state, at a glance).
3. Per-day detail (result, trade count, win rate, journal indicator).
4. Per-week summary (result, traded-day count).
5. Day-detail-on-click (deferred content, see §14).

## 4. Month navigation

**[SOLID SKILL DECISION]** The Calendar Workspace header must support:

- Navigate to the previous month.
- Navigate to the next month.
- A "This month" control that returns to the current calendar month.
- Display of the currently viewed month and year.

## 5. Monthly summary

**[SOLID SKILL DECISION, following VERIFIED Advanced Calendar behavior]**
The header must be able to show, for the currently viewed month:

- The monthly result, expressed using the selected global representation
  mode (see §10).
- The monthly traded-day count (number of distinct days with at least one
  realized trade in the month).

## 6. Calendar-grid structure

**[SOLID SKILL DECISION, following VERIFIED Advanced Calendar behavior]**

- Seven weekday columns.
- A complete grid for the viewed month (including the leading/trailing
  days of adjacent months needed to fill full weeks — visual treatment for
  those is deferred to implementation, but the grid must always represent
  complete weeks).
- Week rows, each aligned with one weekly-summary entry (see §8).

## 7. Day-cell information

**[SOLID SKILL DECISION, informed by OBSERVED day-cell content]** Each
trading-day cell must be *capable* of showing:

- The date.
- Realized result, expressed using the selected global representation mode.
- Trade count for that day.
- Trade win rate for that day.
- A journal-entry indicator, when a journal entry exists for that day.
- An outcome state: positive / negative / break-even / no-trade (see §9).

This is the same data-point ceiling `VISUAL_FOUNDATION.md` §10 already
fixes for cell layout (date, P&L, trade count, note indicator) plus win
rate as a value that may share the cell's metric row — visual placement is
left to implementation, not fixed here.

## 8. Weekly summaries

**[SOLID SKILL DECISION, following VERIFIED weekly-summary behavior]** Each
week row must be paired with a weekly-summary entry capable of showing:

- The week label ("Week N").
- The weekly result, expressed using the selected global representation
  mode.
- The traded-day count for that week.

## 9. Outcome states

**[SOLID SKILL DECISION]** Every day cell resolves to exactly one of four
visual states:

- **Positive** — realized result classifies as a win.
- **Negative** — realized result classifies as a loss.
- **Break-even** — realized result classifies as neither win nor loss.
- **No-trade** — no realized trading activity occurred that day.

Classification into positive/negative/break-even must **not** hardcode the
assumption that `P&L > 0` is a win, `P&L < 0` is a loss, and `P&L == 0` is
break-even. See §12. This document does not define the final threshold
algorithm.

## 10. Global representation modes

**[SOLID SKILL DECISION]** The Calendar's result values (monthly, daily,
weekly) must eventually respond to the same global data-representation
switcher described in `VISUAL_FOUNDATION.md` §5.5, rather than maintaining
their own independent unit choice. Candidate modes, account-type-dependent:

- **Futures**: `$`, `%`, `R`, Ticks, Points.
- **Forex / CFD**: `$`, `%`, `R`, Pips.

No calculation for any of these modes is defined or implemented in this
checkpoint.

## 11. Realized-P&L principle

**[SOLID SKILL DECISION — architectural requirement]** Calendar data must
ultimately be derived from **realized** trading activity only — results
that have actually occurred, not open/unrealized positions. A partial exit
may realize a portion of a trade's result on the date that partial exit
occurred, meaning a single multi-day trade can contribute realized result
to more than one calendar day.

This has a direct consequence for the Normalization Layer and Trading
Domain (`ARCHITECTURE.md`): trade reconstruction must be able to attribute
realized result to specific dates/executions, not only to a trade's overall
close date. This is documented here as a forward-looking constraint on
future normalization/trade-reconstruction work — it is not implemented by
this checkpoint.

## 12. Break-even configurability

**[SOLID SKILL DECISION]** The threshold that separates "break-even" from
"small win"/"small loss" must eventually be user-configurable, not a fixed
`== 0` comparison. This document does not define that threshold algorithm,
its unit (currency, R, percentage, ticks), or its default value — only that
the four outcome states in §9 must be produced by a configurable
classification step, not an inline comparison scattered through the
codebase.

## 13. Journal indicator

**[SOLID SKILL DECISION, following VERIFIED journal-entry-indicator
behavior]** A day cell must be able to indicate that a journal entry
exists for that date. Per `VISUAL_FOUNDATION.md` §10, this indicator is
informational only (presence/absence of a note) and must never carry
positive/negative/warning color semantics — a journal entry is not an
outcome.

## 14. Future selected-day behavior

**[SOLID SKILL DECISION]** Clicking a calendar day will eventually reveal
a day-detail area. This is explicitly a Solid Skill product decision, not
a claimed or verified TradeZella behavior beyond the general pattern of
day-level drill-down implied by a calendar existing at all.

Potential contents (not finalized, not visually designed):

- Daily result.
- Trade count.
- Win rate.
- R result.
- The trades executed that day.
- The strategy associated with each trade.
- Process compliance for that day's trades.
- The day's journal entry.
- Notes/screenshots.

Exact content, layout, and interaction (inline expansion vs. drawer vs.
navigation to the Journal filtered by date) are not decided in this
checkpoint.

## 15. Explicit non-goals for V1

- No implementation of any calculation described above (monthly/weekly/
  daily results, win rate, break-even threshold, representation-mode
  conversions).
- No day-detail UI design or build.
- No adoption of TradeZella's separate Reports → Calendar concept (yearly
  calendar, Daily Net Cumulative P&L, "Overall Evaluation").
- No backtesting-adjacent functionality of any kind.
- No visual/CSS implementation — `VISUAL_FOUNDATION.md` §10 remains the
  concrete visual reference to update, if needed, once this spec is acted
  on.
- No database schema or migration for calendar-backing data.

## 16. Open questions requiring human/product validation

1. What exact realized-P&L attribution rule applies when a trade's entries/
   exits span multiple calendar days with partial exits — is result
   attributed to the exit date only, proportionally, or some other rule?
2. What is the default break-even threshold (and its default unit) before
   a user configures one explicitly?
3. Does "traded-day count" (monthly, weekly) count a day with only
   break-even trades as a traded day? (Implied yes, since a trade occurred,
   but not yet confirmed as a product decision.)
4. Should the weekly summary include partial weeks that fall outside the
   viewed month (leading/trailing days), or only count activity within the
   viewed month's own days?
5. Does trade win rate on a day-cell use the same win/loss/break-even
   classification as the day's overall outcome state, or a per-trade
   classification that could disagree with the cell's aggregate state
   (e.g., a day with 2 wins and 1 larger loss showing "positive" P&L but a
   sub-50% win rate)?
6. Is the global representation-mode switcher truly page-global (per
   `VISUAL_FOUNDATION.md` §5.5), meaning the Calendar's mode is inherited
   from the top toolbar rather than having any calendar-local override?
7. What interaction pattern should selected-day detail use (inline
   expansion, side drawer, or navigation into Journal filtered by date) —
   deferred in §14 but will need a decision before implementation.
8. Should days outside the active month (per `VISUAL_FOUNDATION.md` §10's
   dimmed-but-visible treatment) be clickable for day-detail, or inert?
