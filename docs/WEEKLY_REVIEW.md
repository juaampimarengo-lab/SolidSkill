# Solid Skill — Weekly Review

Checkpoint 015. The Weekly Review turns Solid Skill from a trade archive into a
process journal: for one account and one week it puts the week's **results**,
the week's **process compliance**, the trader's **forecast vs actual**, the
day-by-day breakdown, the week's **Rule evaluations**, the Trades and their
Chart Evidence, and the trader's own **reflection** on one screen.

It answers, from persisted data only:

- What did I expect this week? (Forecast / Intention, authored)
- What actually happened? (Actual, authored + the outcome summary)
- Did I follow my process? (Process summary, from Rule evaluations)
- Which Rules were failed? (Rule review, factual counts)
- Which Trades had the highest / lowest compliance, regardless of outcome?
- Which days were strongest / weakest? (Daily breakdown)
- What should I repeat / stop doing? What is the plan for next week? (authored)

It is **not** a P&L report and **not** Behavior Analytics (see §13).

## 1. Outcome vs process

The two are computed by separate functions from separate inputs
(`src/renderer/src/lib/weeklyReview.ts`):

- `computeOutcomeMetrics(trades)` reads only P&L / R / direction / dates.
- `computeProcessMetrics(trades)` reads only the persisted rule-state counts.
  P&L is never an input — the smoke suite proves that flipping every Trade's
  P&L leaves the process metrics byte-identical.

They render as two side-by-side sections with their own explanatory line
("A profitable week is not evidence of good process …" / "Measured from your
Rule evaluations only. P&L is never an input."). A losing Trade can be fully
compliant and a winning Trade can carry a FAIL; the fixture and the smoke
suite contain both. Nothing labels a Trade "best" or "worst": the page shows
**Largest gain / Largest loss** (outcome section) and **Highest / Lowest
compliance** (process section) as four distinct factual categories.

## 2. Week identity

- A review week is 7 consecutive **analytical trade dates**, identified by
  `(account_id, week_start_date)` — never by a human label.
- Week start is **Sunday** (`WEEK_START_DAY = 0` in `src/shared/week.ts`).
  This matches the existing Calendar grid, whose "Week N" column already
  totals Sunday → Saturday, so a Calendar week and a Weekly Review week always
  cover the same days. The convention is one explicit constant — the browser
  / OS locale is never consulted. Changing it later is a product decision
  plus a data migration of stored week starts.
- All week math is pure text/day-number arithmetic on `YYYY-MM-DD`; no
  timestamp is ever converted to a date for grouping, and MT5's analytical
  date policy is untouched. No futures session-date policy is applied here.
- "This week" (the initial week) is the one place a local clock is read — the
  same rule as the Calendar's today marker.
- The main process rejects any `weekStart` that is not a canonical week start
  (`INVALID_INPUT`).

## 3. Persistence (migration 004)

`weekly_reviews` stores **only what the trader wrote** (see
`DATABASE_SCHEMA.md` §20):

| column | meaning |
|---|---|
| `account_id`, `week_start_date` | primary key (identity; trigger-protected from change) |
| `forecast` | Forecast / Intention, written before (or during) the week |
| `actual` | Actual — what happened, in the trader's words |
| `went_well` / `needs_improvement` | reflection |
| `repeat_next_week` / `avoid_next_week` / `next_week_focus` | plan for next week |
| `notes` | free-form |
| `forecast_updated_at` | when the forecast text last changed (NULL = never written) |
| `created_at`, `updated_at` | bookkeeping |

Dedicated columns rather than a JSON blob: each prompt is a distinct concept
that later longitudinal analysis should be able to read on its own. Text is
stored **exactly as typed** — never trimmed, normalized or translated (≤ 20 000
characters per field, like notes). Saves are **partial**: only the fields sent
are written; `forecast_updated_at` moves only when the forecast text actually
changes, which lets the UI state honestly "Forecast last edited Sep 22 — edited
on or after the week started".

**No derived metric is persisted.** P&L, Win Rate, trade counts, compliance and
Rule FAIL counts are always recomputed from Trades and evaluations, so a review
can never disagree with — or freeze a stale copy of — the facts. There is no
foreign key from a review to any Trade / version / evaluation and no path by
which a review write touches them.

## 4. Architecture

```
Renderer  WeeklyReviewWorkspace → useWeeklyReview / useAutosave
          lib/weeklyReview.ts (pure derivation)
   ↓ window.solidSkill.reviews (preload)
Main      reviewHandlers (validate) → ReviewService (src/main/review, no Electron)
   ↓
          TradeReadRepository · EvaluationRepository.listForAccountRange
          MediaRepository.listForAccountRange · WeeklyReviewRepository
   ↓
SQLite
```

`ReviewService` is the Review Engine layer of `ARCHITECTURE.md` §6. It reads
the Trading Domain and the Strategy Engine's persisted evaluations and owns one
kind of write: the authored reflection. Metrics are derived in the renderer's
pure `lib/weeklyReview.ts`, **next to** `dayAggregate` / `tradeView`, on
purpose: it reuses the exact classification Day Review and the Calendar use
(same break-even threshold, same day-outcome sign rule, same exact-decimal
sums), so one Trade or day can never read differently on two screens. The
module has no React / Electron / DOM dependency and is tested directly by
`smoke:weekly-review`.

## 5. Derived outcome metrics

All account-scoped, from the week's persisted Trades, exact decimal arithmetic
(`lib/decimal.ts`; averages round half away from zero at 8 dp):

- Trade count; Net P&L; Gross P&L; Costs (signed commission + fees + swap).
  `null` (unreported) is shown as "—", never as 0.
- Winners / losers / break-even: `tradeOutcome` — the same classification as
  Day Review (|net| < the presentation break-even threshold is break-even).
- Win Rate = winners / trades × 100 (Day Review's definition).
- Average winner / loser = mean net P&L of the classified winners / losers;
  "—" when there are none.
- Profit Factor = Σ positive net / |Σ negative net| (strict sign); **undefined
  ("—") when there is no losing Trade**, 0 when there is no winning one.
- LONG / SHORT counts (persisted direction).
- Days traded; winning / losing / flat days by the day's total net sign (the
  Calendar cell rule).
- R: only Trades that carry realized R contribute. The page shows "R reported
  on n of m"; **a missing R is never 0R**, and a week with no R shows "No R
  reported". Imported MT5 Trades have no R and none is fabricated.
- Largest gain / largest loss by net P&L (factual extremes only).

## 6. Process metrics and compliance math

From each Trade's persisted rule-state counts:

- **PASS / FAIL / N/A / UNREVIEWED** — pooled over every rule check of the
  week.
- **Compliance = PASS / (PASS + FAIL)**, pooled; N/A and UNREVIEWED are
  excluded from the denominator; undefined ("—") when PASS + FAIL = 0.
  Same function as everywhere else (`src/shared/compliance.ts`).
- **Review completeness** is separate: judged rule checks / all rule checks.
- Trade buckets: *Reviewed* (Strategy Trade, no UNREVIEWED), *Review
  incomplete* (Strategy Trade with ≥ 1 UNREVIEWED), *No Strategy* — the three
  add up to the trade count. A Trade without a Strategy is never counted as
  FAIL or UNREVIEWED; it is its own bucket.
- *Fully compliant* = review complete, no FAIL, ≥ 1 PASS. *With a FAIL* = at
  least one recorded FAIL, whether or not the review is complete.
- Highest / lowest compliance among Trades whose compliance is defined (ties
  keep the earliest Trade; "lowest" is hidden when it would repeat "highest").
- Nothing is weighted by P&L.

## 7. Rule violation semantics

The Rule review lists, per **exact Strategy Version** evaluated that week, every
rule with its PASS / FAIL / N/A / UNREVIEWED counts, and above it the rules
failed that week, most FAILs first:

> Rule C · Strategy Alpha v3 · FAIL on 1 Trade · Those Trades: 1 positive · 0
> negative · 0 flat

The outcome tally is descriptive context, followed by an explicit disclaimer
("They do not show that the rule caused the result"). No sentence anywhere says
a rule causes, leads to, or explains an outcome — that is future Behavior
Analytics with sample-size gating (`ARCHITECTURE.md` §5). A missing evaluation
is UNREVIEWED, never FAIL.

## 8. Strategy Version integrity

Rule rows come from `EvaluationRepository.listForAccountRange`, which joins each
evaluation to the rule row **of the version it was recorded against**
(`e.rule_id` + `e.strategy_version_id`). A Trade evaluated on Alpha v2 is
reviewed against v2's rules even after v3/v4 are published; the same logical
rule in two versions has two rule ids and two rows. The Strategy's *current*
display name is shown (names are user data, not versioned), with the historical
version number and wording. Trades without a Strategy show "No Strategy"; no
evaluation is fabricated.

Since Checkpoint 015B a Trade can be assigned an exact published version from
Trade Review (`STRATEGY_ASSIGNMENT.md`). That writes only the association and
UNREVIEWED evaluation rows; Weekly Review picks them up on its next read (the
overlay's Back bumps its revision) through exactly the same read model — there
is no Weekly-Review-specific write, metric copy or achievement path.

## 9. Forecast vs Actual

Two authored text areas side by side. The forecast is the trader's own
expectation / intention — Solid Skill never generates, suggests or scores a
market forecast and uses no AI for it. The *Actual* text is the trader's
narrative; the numeric "what happened" is the Outcome / Process sections above.
Below the forecast: "Forecast last edited ⟨date in the account's timezone⟩",
flagged "edited on or after the week started" when applicable. V1 does not keep
a version history of the forecast (see §14).

## 10. Daily review (Day Review) — decision

Day Review previously showed the single `day_notes.body` read-only. Choice:
**A — keep one Day Note, structure the UI lightly.** The note is now editable in
Day Review (`DayNoteEditor`) with the same autosave, and its placeholder
suggests the four prompts (Plan / expectation · What happened · What went well
· What could improve). Why not separate fields: the existing Day Note is
already shown in Trade Review and marked on the Calendar, users already have
notes in it, and a four-field day form would duplicate the weekly prompts
without a current analytical need. No schema change for Day Notes. Splitting it
later would be a deliberate migration.

## 11. Daily breakdown, Trade drilldown, Chart Evidence

- **Daily strip:** the 7 days of the week, each with weekday, date, net P&L
  (Calendar colouring), trade count, pooled compliance + review state (or "No
  Strategy"), a Day Note indicator and a Day-chart indicator. Clicking a day
  pushes the existing Day Review overlay for *(active account, that date)*;
  Back returns to the same week (the workspace stays mounted), and the week
  silently re-reads so a Day Note written there shows its indicator.
- **Trades:** the Journal's own `TradeTable` + quick-review `TradeReview` panel —
  click selects and inspects, double-click / Enter / "Open full review" push the
  existing canonical Trade Review through App's single `openTradeReview`. No
  second Trade Review UI exists.
- **Chart Evidence:** a compact strip of the week's Day charts plus each Trade's
  *featured* chart (non-featured Trade charts stay in Trade Review). Images load
  through the existing read-only `ssmedia://<id>` protocol from the existing
  files — nothing is copied, and there is no add/delete action here. Clicking a
  tile opens the existing lightbox.

## 12. Save behaviour

Deliberate autosave (`hooks/useAutosave.ts`), shared by the weekly reflection
and the Day Note:

- debounced (~0.8 s after the last keystroke), never one write per keystroke;
- only fields changed since the last successful save are sent (partial save);
- edits made during an in-flight save are queued and saved next;
- flushed immediately on blur, on unmount (changing week / section / account)
  and on window unload;
- a subtle state line: "Saved automatically as you type" → "Unsaved changes" →
  "Saving…" → "Saved", or "Couldn't save — your text is kept here. Retry". A
  failed save never clears the text; the local draft is the source of truth for
  the text area and a server response never overwrites typing.

## 12a. Progress, scorecard and achievements (Checkpoint 015 polish)

Three blocks added on top of the review, all process-only (no P&L input):

**Progress bars** (`computeWeekProgress`, top of the page):

- *Process Compliance* = PASS / (PASS + FAIL), pooled over the week's
  Strategy Trades — the same number as the Process section (it reuses
  `computeProcessMetrics`). N/A and UNREVIEWED are excluded. Detail line:
  raw counts ("15 PASS · 1 FAIL").
- *Review Completion* = reviewed Trades / **all** Trades of the week, where
  reviewed = has a Strategy and no UNREVIEWED rule (the Process section's
  "Reviewed" bucket). A Trade without a Strategy counts in the denominator —
  it has not been reviewed — and the detail line names it ("· 2 without a
  Strategy"). This is a Trade-level ratio; the Process section's *Review
  completeness* is the rule-check-level ratio. Both are shown deliberately.
- Undefined denominators (no Trades; no PASS/FAIL judged) render an outlined,
  empty track and "—" — never 0% or 100%. No Strategy → compliance "—",
  completion 0%. Partial and full review render the exact ratio.

**Weekly Scorecard** (migration 005, `DATABASE_SCHEMA.md` §21): six fixed,
generic self-assessment dimensions — Discipline, Patience, Risk management,
Execution quality, Focus, Review quality — each a 1–5 score and an optional
short note (≤ 500 chars). The dimensions describe how the trader conducted
themselves and imply no trading methodology. UI: one dense row per dimension
(icon · label + one-line description · 1–5 step control · note). Selecting the
current score again clears it. Autosave uses the same `useAutosave` as the
reflection but a **separate instance and table**: a click saves immediately,
note typing is debounced and flushed on blur/unmount, and a scorecard save can
never carry or overwrite reflection text. Its own save-state line sits in the
section header.

**Achievements** (`computeAchievements`, derived on every render from facts +
the on-screen draft; never persisted):

| id | label | earned when |
|---|---|---|
| `reviewComplete` | Review complete | all six dimensions rated **and** What went well, What needs improvement, Next week focus written |
| `tradesReviewed` | All Trades reviewed | ≥ 1 Trade and every Trade reviewed (No-Strategy Trades block it) |
| `noRuleFails` | No FAIL recorded | ≥ 1 rule judged PASS/FAIL and zero FAIL |
| `cleanProcess` | Clean process week | every Trade has a Strategy, a complete review, no FAIL and ≥ 1 PASS |
| `forecastCompleted` | Forecast completed | Forecast / Intention and Actual both written |
| `consistentReviewer` | Consistent reviewer | this week and the previous 3 consecutive weeks each have an authored review (text or scorecard) |

Guardrails: no achievement reads P&L (the smoke flips every P&L and gets the
same result); none rewards volume — every trade-based condition must hold for
*all* of the week's Trades, so one clean Trade earns exactly what twenty do;
whitespace never counts as written. Low self-ratings still complete the review.
*Risk Discipline* from the brief is deliberately **not** implemented: no
methodology-neutral risk fact is persisted (no planned risk / stop on Trades),
and inventing a threshold would hardcode a trading rule (`CLAUDE.md` rule 2).
Chips are small bordered labels with one line icon; earned ones use the violet
accent, unearned ones stay neutral, and the tooltip states the criterion.

**Visual system:** violet accent tokens and `text-helper` are defined in
`tokens.css` and documented in `VISUAL_FOUNDATION.md` §2.3a. Every section
heading carries one lucide line icon (15px, stroke 1.75) in `accent-mid` with
the title in `accent-soft`. Helper prose moved from 12px/muted to
13px/1.5 in `text-helper`; field hints, footnotes, save state, day-cell meta
and chart captions from 11px to 12px.

## 13. Active account, localization, empty states

- **Active account:** the workspace is keyed by the active account id; switching
  accounts remounts it (flushing any pending text for the previous account) and
  every read is scoped by `accountId` in SQL. No cross-account mixing.
- **Localization:** all new product prose is in the `review` namespace
  (`en` / `es`, key parity enforced by `smoke:i18n`). Canonical terms — Trade,
  Strategy, P&L, Net / Gross P&L, Win Rate, Profit Factor, Long / Short, R,
  PASS / FAIL / N/A / UNREVIEWED — stay literal and are injected into translated
  sentences by interpolation. User data (reflection text, Day Notes, Strategy /
  Rule names, account names, symbols) is never passed through `t()`; switching
  language leaves authored text byte-identical (verified in `qa:weekly-review`).
  Dates keep the existing English month labels (`LOCALIZATION.md` limitation).
- **Empty states:** no Trades this week; Trades but no Strategy ("None of this
  week's Trades is associated with a Strategy …"); Strategy but nothing judged
  ("Compliance stays undefined until …"); no Rule evaluations; no FAIL; no Day
  Notes / charts (indicators simply absent); no Chart Evidence; zero-P&L,
  one-Trade, all-loss and all-win weeks (Profit Factor "—" / 0 as defined in
  §5). No fixture fallback: a failed read is an error state.

## 14. Boundary with future Behavior Analytics

Weekly Review reports **observations** for one week: counts, sums, and the
trader's words. It does not correlate rules with outcomes across weeks, does
not rank Strategies, does not generate advice, does not predict markets and
does not export. Those belong to the Behavior Analytics Engine, which must add
sample-size and significance gating before any "emerging" or "meaningful"
pattern language (`CLAUDE.md` Absolute Rule 4). The authored columns are
deliberately separate so that engine can later read "forecast", "repeat",
"avoid" … longitudinally.

Known V1 limitations:

- The forecast is not versioned; only its last-edit time is kept.
- The week start is fixed (Sunday) — not yet a user setting.
- Money is shown with the existing `$` formatter regardless of account currency
  (same as every other screen); the $ / % / R / PTS selector does not convert.
- The Topbar "This Week" pill remains a static placeholder; Weekly Review has
  its own week navigation.
- `listDaysWithNotes` (Calendar / daily indicator) treats a note of only
  newlines/tabs as non-empty (it trims spaces only) — pre-existing behaviour.

## 15. QA

- `npm run smoke:weekly-review` — week identity, migration 004 (fresh and on top
  of an existing 001–003 database), scoping, all outcome / process / rule /
  daily derivations and edge cases, historical version integrity (a newer
  published version + rename never reinterprets the week), media reuse, authored
  persistence (exact text, partial saves, forecast timestamp, account isolation,
  restart, identity trigger), IPC validation, and a digest proving no Trade-side
  fact changes.
- Progress / scorecard / achievements are covered in both suites: migration
  005 (fresh and on top of 001–004), exact / partial / cleared scorecard saves,
  reflection isolation, restart, IPC validation, bar values for empty / no
  Strategy / no evaluations / partial / full weeks, every achievement's
  criteria, purity on deep-frozen inputs, and — in the real app — score clicks,
  note autosave, live chip updates, EN ↔ ES and cross-account isolation.
- `npm run qa:weekly-review` (after `npm run build`) — drives the real app
  against a throwaway copy of the development database + media: Demo and MT5
  weeks, typing through the UI, drilldown and Back, Day Note editing, EN ↔ ES,
  restart, account isolation, and fact / media-file digests.
