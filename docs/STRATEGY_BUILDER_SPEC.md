# Solid Skill — Strategy Builder Specification (V1)

Checkpoint 009. This is a **conceptual and information-architecture
specification** for the Strategy Builder product area described in
`PRODUCT.md` and modeled at a domain level in `STRATEGY_ENGINE.md`. It
elaborates the user-facing product model — rule evaluation states,
applicability, compliance, required/optional rules, trade↔strategy
relationships, and workspace structure — that `STRATEGY_ENGINE.md` leaves at
the level of domain concepts. It does not restate or override
`STRATEGY_ENGINE.md`; where the two overlap, `STRATEGY_ENGINE.md` is
authoritative and this document only adds detail consistent with it (any
place that isn't consistent is flagged explicitly in §16, not silently
resolved).

This document contains no database schema, no SQL, no TypeScript interfaces,
and no rule-evaluation or condition-expression syntax. It is not an
implementation plan.

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

The Strategy Builder is where a trader defines their own trading
methodology as structured, versioned, evaluable data — never as anything
Solid Skill assumes or bakes in on their behalf. It exists to produce the
input the Strategy Engine (`STRATEGY_ENGINE.md`) evaluates trades against,
and the output (Trade Rule Results) that Trade Review (`JOURNAL_SPEC.md`)
displays and Behavior Analytics (`ARCHITECTURE.md`) consumes.

The Strategy Builder must let two unrelated users build two unrelated
methodologies and have Solid Skill treat both identically — as generic,
user-authored structure — per `STRATEGY_ENGINE.md`'s fundamental rule and
`CLAUDE.md` Absolute Rule 2.

## 2. TradeZella reference facts

**[VERIFIED]** A TradeZella Strategy can have a name, description,
icon/image, and color. Strategies contain Rule Groups/Criteria, which
contain Rules. Rules are user-created and tailored to the trader's own
style. TradeZella documents rule applicability/display settings: show when
winner, show when loser, show when breakeven, always show. TradeZella
states that once a trade is linked to a rule, some rule applicability
settings cannot be changed. Trades are associated with Strategies from
Trade Page/trade-management workflows. Per-trade rules can be checked off.
TradeZella exposes rule-level analysis: follow rate, net P&L, profit
factor, win rate. TradeZella also supports strategy templates/shared
strategies and missed-trade features (see §17).

**[SOLID SKILL DECISION — explicit boundary]** TradeZella's public
documentation does **not** establish a historical strategy-version
architecture comparable to what `STRATEGY_ENGINE.md` and
`STRATEGY_VERSIONING.md` require. Solid Skill's versioning model (§9–§13
and the whole of `STRATEGY_VERSIONING.md`) is a Solid Skill product
decision with no TradeZella precedent claimed for it. Similarly,
TradeZella's winner/loser/breakeven/always applicability is reference
material only (§7) — it is not adopted as Solid Skill's applicability
model.

## 3. Solid Skill principles

- No trading-methodology concept is ever hardcoded (`CLAUDE.md` Absolute
  Rule 2, `STRATEGY_ENGINE.md` "Fundamental rule"). Every example rule
  name in this document is illustrative user data, not an application
  concept.
- Process and outcome are separate axes (`PRODUCT.md`, `CLAUDE.md` Absolute
  Rule 5). A rule's evaluation must never be inferred from whether the
  trade made money, and a strategy's compliance score must never be
  weighted by P&L.
- Historical integrity is mandatory (`CLAUDE.md` Absolute Rule 3,
  `STRATEGY_ENGINE.md` "Historical integrity"). Nothing in this document
  may be read as license to let a strategy edit alter a past evaluation.
- No causal claims from correlation (`CLAUDE.md` Absolute Rule 4). Rule
  follow-rate-vs-outcome analytics are out of scope for this checkpoint but
  must, when eventually built, follow that rule (§15).

## 4. Strategy

A durable, user-created identity/container, matching `STRATEGY_ENGINE.md`'s
"Strategy" concept. Conceptually carries:

- Name
- Description
- Optional visual identity (icon/color, per the **[VERIFIED]** TradeZella
  pattern in §2 — presentation only, never logic)
- Lifecycle state: active or archived (§14)
- A reference to its current published version, if one exists (§9)
- A reference to its current draft, if one is in progress (§5)

A Strategy's identity is stable across versions — "Strategy Alpha" is the
same Strategy whether it is on v1 or v9. Nothing about a Strategy's name,
description, or visual identity changing requires a new version (§11), but
none of those fields change what a historical trade evaluated against an
older version displays (§9).

No schema/storage fields are finalized here.

## 5. Strategy Draft

An editable working state, scoped to a Strategy, that the user freely
mutates before publishing:

- Add/remove/reorder Rule Groups.
- Add/remove/reorder Rules.
- Edit rule/group wording and descriptions.
- Change applicability/conditions (§8).

A Draft is not evaluable against trades. It has no historical standing —
trades are never associated with a Draft, only with a published Version
(§9). Draft changes must never silently mutate historical Trade Rule
Results; this holds even while a Draft is being edited, since the Draft and
the previously published Version it was based on are distinct objects
throughout the editing process, not the same record being mutated in
place.

A Strategy has at most one open Draft at a time (per §13 draft/publish
lifecycle) — Solid Skill does not need parallel competing drafts of the
same Strategy in V1.

## 6. Strategy Version

A published, frozen definition of the Strategy at a point in time, per
`STRATEGY_ENGINE.md`. Sequential and simple:

```
Strategy Alpha
  v1
  v2
  v3
```

Once any trade has been evaluated against a Version, that Version's
definition — its Groups, Rules, applicability, and dependencies — is
permanently immutable. See `STRATEGY_VERSIONING.md` for the full lifecycle,
what triggers a new version, and the draft→publish flow. This document
treats Strategy Version only as the object Rule Groups and Rules belong to
and the object a Trade references (§10).

## 7. Rule Group

A user-defined organizational container for Rules within a Strategy
Version, matching `STRATEGY_ENGINE.md`'s "Rule Group" concept.

- Has an order (position among the Version's groups).
- May have a name and description — entirely user-authored (e.g., "Entry
  Criteria," "Risk Criteria," "Group A" — these are examples of what a user
  might type, never application-level categories Solid Skill recognizes or
  special-cases).
- Contains an ordered list of Rules.
- May eventually support display/collapse UI behavior — not decided here.

Different Strategies, and different Versions of the same Strategy, are not
required to share any group structure. A Version may also have zero groups
beyond an implicit ungrouped list, if the user never creates one — this
document does not mandate that every Strategy use groups, only that the
capability exists.

## 8. Rule

A single user-defined process criterion, matching `STRATEGY_ENGINE.md`'s
"Rule" concept:

- Title/name — user-authored free text.
- Description — optional, user-authored free text.
- Order — position within its Rule Group.
- Kind — required, optional, or conditional, per `STRATEGY_ENGINE.md` §"Rule"
  (see §11 of this document for the V1 recommendation on how deeply
  required/optional semantics should be surfaced).
- Applicability (§7 of this document, "Applicability / Conditions" section
  below — note the section-number collision with §7 Rule Group above is
  addressed by referring to it by name).
- Zero or more conditions/dependencies (§9 of this document).

The Strategy Engine evaluates a Rule generically — did the trader mark this
rule PASS, FAIL, or N/A for this trade (§ Rule Evaluation States below) —
and never interprets what the rule text means. This holds regardless of how
specific or methodology-flavored the rule's wording is.

## Applicability / conditions

`STRATEGY_ENGINE.md` establishes that Rules may have conditions/dependencies
expressing structural logic (e.g., "only evaluate Rule B if Rule A was
satisfied," "at least N of M rules must be satisfied") without the engine
understanding trading semantics. This section elaborates the applicability
side specifically: *when does a Rule apply to a given trade at all*, as
distinct from *whether it passed once applicable*.

**[SOLID SKILL DECISION — divergence from the TradeZella reference]**
TradeZella's documented applicability model (§2) is outcome-based: show
when winner / loser / breakeven / always. Solid Skill must not adopt
outcome-based applicability as the default or only model, because a rule
whose applicability is conditioned on the trade's own result is structurally
in tension with `CLAUDE.md` Absolute Rule 5 (process and P&L must be kept
separate) — evaluating "was this rule followed" only after knowing the
trade won or lost invites the trader's post-hoc knowledge of the outcome to
color a judgment that should be about process. Solid Skill should not
prevent a user from configuring outcome-conditioned applicability if they
explicitly want it (it is their methodology to define), but it must not be
the default, the only option, or presented as an application-level concept
of "winner/loser/breakeven" — it is one instance of a general,
user-configured condition (see below), not a built-in special case.

**Methodology-agnostic condition concept (future, not built now).** A
Rule's applicability should eventually be expressible as a condition
referencing:

- Another Rule's state (applicable/not applicable, or its evaluation
  result).
- Instrument/account/context attributes already known to the Trading
  Domain (e.g., asset class, account) — never trading-methodology
  attributes invented by Solid Skill.
- User-defined state the trader records elsewhere (e.g., a tag) — but only
  if and when Solid Skill's tag model (`JOURNAL_SPEC.md` §10) is stable
  enough to be referenced this way; not assumed available now.
- The trade's own recorded outcome (§ divergence note above), available
  but never default.

No condition-expression syntax, grammar, or evaluation algorithm is defined
in this checkpoint. This section documents requirements and open questions
only (§16 carries the unresolved ones forward).

**Default V1 recommendation:** absent any configured condition, a Rule is
"always applicable" — every trade evaluated against the Version that
contains it gets a PASS/FAIL/N/A/UNREVIEWED state for that Rule (§ Rule
Evaluation States). Conditional applicability is an explicit opt-in a user
configures per rule, not an ambient default behavior.

## Dependencies

Per `STRATEGY_ENGINE.md`, Rules may depend on other Rules (prerequisites,
"at least N of M," ordering). The future Strategy Builder must present
these relationships in a way that scales beyond flat text rows — the
product intent is for strategy structure to become diagrammable/visual, so
a user can *see* dependency chains rather than infer them from a list. This
requirement shapes future UI/data-modeling work; it does not mandate any
specific graph representation now. No graph database, node schema, or
flowchart engine is designed in this checkpoint.

## 9. Rule Evaluation States

Per trade, each applicable Rule resolves to one of:

- **PASS** — the applicable process requirement was satisfied.
- **FAIL** — the applicable process requirement was not satisfied.
- **N/A** — the trader explicitly determined this rule does not apply to
  this trade/context. N/A is a deliberate, user-asserted judgment, not a
  default or a placeholder.

**[SOLID SKILL DECISION — V1 recommendation]** PASS/FAIL/N/A alone are
insufficient to represent a Rule's lifecycle state, because a newly
imported or newly strategy-associated trade has not necessarily been
reviewed yet. Using N/A, FAIL, or any evaluated state as a default for an
unreviewed rule would misrepresent the trader's judgment as having been
exercised when it has not. Solid Skill V1 should therefore add a fourth,
distinct state:

- **UNREVIEWED** — the trader has not yet evaluated this rule for this
  trade. This is the default state for every applicable Rule at the moment
  a trade is first associated with a Strategy Version, and it remains the
  state until the trader explicitly sets PASS, FAIL, or N/A.

UNREVIEWED must never be conflated with N/A. N/A means the trader looked at
the rule and determined it doesn't apply. UNREVIEWED means the trader
hasn't looked yet. Collapsing them would let an unreviewed trade silently
present as if the process check had already happened — a form of
misrepresenting review completeness, and functionally close to letting a
missing judgment masquerade as a rendered one.

**Relationship to `STRATEGY_ENGINE.md`.** `STRATEGY_ENGINE.md` now defines
Trade Rule Result with all four states (PASS, FAIL, N/A, UNREVIEWED) and
the compliance-vs-review-completeness distinction directly, reconciled in
Checkpoint 009's consistency patch. This section's account is consistent
with, and no longer ahead of, that document.

## 10. Compliance

Four distinct compliance concepts must never be conflated with each other
or with profitability:

1. **Rule Result** — PASS/FAIL/N/A/UNREVIEWED for one Rule on one Trade
   (§9).
2. **Group Compliance** — an aggregate over one Rule Group's Rules for one
   Trade.
3. **Trade Compliance** — an aggregate over all applicable Rules across all
   Groups for one Trade.
4. **Strategy Compliance Over Time** — an aggregate of Trade Compliance
   across many Trades evaluated against one Strategy (possibly spanning
   multiple Versions — see `STRATEGY_VERSIONING.md`).

A trade's P&L must never be a factor in any of these four calculations.
+$2,000 with two rule violations is not "80% compliant because it made
money" — it is whatever its actual PASS/FAIL ratio says, full stop.
-$500 with all rules passed is 100% compliant despite losing.

### V1 compliance formula

**[SOLID SKILL DECISION]** Recommended V1 formula, applied at both Trade
and Group level:

```
Compliance = PASS / (PASS + FAIL)
```

- N/A rules are excluded from both numerator and denominator — they were
  never a live requirement for this trade, so they should not dilute or
  inflate the score.
- UNREVIEWED rules are excluded from the formula the same way, **but their
  presence must be surfaced separately and visibly** as "review
  incomplete" (e.g., "3/5 rules reviewed") rather than allowing the
  Compliance percentage to imply a fully reviewed trade. A trade with one
  PASS and four UNREVIEWED rules must never display "100% compliant" — it
  must display something like "100% of reviewed rules (1/5 reviewed)," or
  equivalent copy that cannot be read as a complete verdict. Exact copy is
  a future UI decision; the requirement that review-completeness and
  compliance-percentage be visually distinguishable is not.
- If PASS + FAIL = 0 (every applicable rule is N/A, or there are no
  applicable rules at all), Compliance is undefined/not-applicable for that
  Trade — never rendered as 0% or 100% by default.

This is intentionally the simplest transparent formula available:
unweighted, no hidden coefficients, no AI-generated discipline score, no
P&L weighting. `CLAUDE.md` Absolute Rule 4 and `ARCHITECTURE.md`'s Behavior
Analytics Engine obligations (observation vs. emerging vs. statistically
meaningful pattern, no causal claims) apply once this Compliance figure is
used in aggregate analytics — this document only defines the per-trade/
per-group number itself, not what Analytics is allowed to say about trends
in it.

## 11. Required vs. optional rules

`STRATEGY_ENGINE.md` already establishes that a Rule has a "kind: required,
optional, or conditional" as part of the domain model. This checkpoint's
task is to analyze whether V1 should expose required/optional distinctly in
the *compliance* semantics (§10), not to re-decide whether the kind field
exists — it already does, per `STRATEGY_ENGINE.md`.

**Benefit of distinguishing required vs. optional in compliance:** lets a
trader express "this must always be true" (e.g., a hard risk rule)
separately from "this is good practice but not mandatory," and lets a
future Trade Compliance figure weight or gate on required rules
specifically (e.g., "all required rules passed" as a distinct, stricter
signal from overall percentage compliance).

**Cost:** as soon as required/optional feeds into a *score* rather than
just a *label*, the compliance formula in §10 stops being the single simple
number it currently is — does an optional-rule FAIL count the same as a
required-rule FAIL? Does "Trade Compliance" become two numbers (required-
only and overall)? This is exactly the kind of ambiguity the checkpoint
instructions warn against introducing without a design pass.

**[SOLID SKILL DECISION — V1 recommendation]** Keep `STRATEGY_ENGINE.md`'s
required/optional/conditional **kind** field as-is (it is already decided,
domain-level, and does not need re-litigating here), but do **not** let it
affect the §10 Compliance formula in V1. Required/optional is a label the
UI can display and filter on (e.g., "show required rules only") and a
future input to a *separate*, explicitly-designed metric (e.g., "required-
rule compliance") — but V1's single Compliance percentage should remain the
unweighted PASS/(PASS+FAIL) formula across all applicable, evaluated rules
regardless of kind. Introducing a required-weighted score is a real,
useful, but separate future decision — not a V1 blocker, and not something
to bolt onto §10 informally. "Conditional" rules are addressed by
applicability (the section above), not by a separate compliance weighting.

## 12. Trade ↔ Strategy relationship

**[SOLID SKILL DECISION — V1 recommendation: one primary Strategy per
Trade.]**

Three candidates were considered, per the checkpoint's framing:

- **A. Exactly one primary Strategy per Trade.**
- **B. One primary Strategy + secondary references.**
- **C. Multiple equal Strategies per Trade.**

Reasoning:

- **UX complexity**: A is simplest to build and to explain to a trader — one
  strategy, one set of rules, one compliance number per trade. B and C both
  require the UI to disambiguate "which strategy's rules am I looking at"
  every time Trade Review or the Journal table shows compliance (§ Trade
  Review Integration below), which is added complexity with no clearly
  established V1 need.
- **Compliance meaning**: Trade Compliance (§10) is only unambiguous when
  it is compliance *against one strategy*. B/C would force a choice between
  showing N compliance numbers per trade (confusing) or a blended number
  (which would violate §10's "no hidden weighting" principle, since
  blending across strategies with different rule counts is itself a hidden
  weighting decision).
- **Analytics clarity**: `ARCHITECTURE.md`'s Behavior Analytics Engine
  already has to gate confident claims behind sample size; splitting each
  trade's process signal across multiple strategies would fragment sample
  sizes further for no demonstrated V1 benefit.
- **Historical versioning**: One Strategy Version reference per Trade keeps
  `STRATEGY_VERSIONING.md`'s historical-snapshot relationship (§9 below and
  the versioning document) a single foreign-key-shaped fact conceptually,
  not a set. This directly supports historical integrity — one trade, one
  version, one snapshot, no ambiguity about which of several versions a
  displayed rule state came from.
- **Real trader workflow**: a trader executing a specific setup is
  generally following one methodology for that trade, even if they
  maintain several strategies for different conditions (`PRODUCT.md`
  already anticipates "multiple strategies ... for different instruments,
  sessions, or account types" — plural strategies *owned by the user*,
  not plural strategies *applied to one trade*).

TradeZella's public material is insufficient to settle this (per the
checkpoint's own framing) — some references suggest single assignment,
some backtesting-adjacent material references multiple, but backtesting is
explicitly out of scope for Solid Skill (`PRODUCT.md`) and not evidence for
this decision either way.

**Recommendation: exactly one Strategy (and exactly one Strategy Version)
per Trade in V1.** Model B (secondary references) is recorded as a future
capability (§15) if real usage shows traders wanting to tag a trade against
more than one methodology for comparison purposes — but it should not be
built speculatively now.

## 13. Strategy workspace information architecture

Structurally inspired by professional trading-journal software and
TradeZella's Strategies concept (§2), at a high level, not pixel-level:

**Strategy List**
- Active strategies
- Archived strategies (§14)
- Create strategy
- Manual order within each section (drag handle + Move up / Move down) —
  presentation metadata, never a new version (Checkpoint 015B,
  `STRATEGY_ASSIGNMENT.md` §8)

**Strategy Detail**
- Overview — name, description, visual identity, current published
  version, draft status if one is in progress
- Rules — the current published version's (or draft's, when editing —
  §`STRATEGY_VERSIONING.md`) groups and rules
- Versions — version history (below)
- Trades / Performance — trades evaluated against this strategy, and
  whatever aggregate compliance/analytics figures are in scope once
  Behavior Analytics is built (`ARCHITECTURE.md`) — not designed in this
  checkpoint

**Rule Builder**
- Ordered groups
- Ordered rules within each group
- Rule description
- Applicability/conditions (§ Applicability / conditions above)
- Add/edit/reorder controls

**Version History**
- v1, v2, v3, ... — sequential list
- Published date per version
- Current version indicator
- Historical versions remain browsable/inspectable indefinitely
- Version comparison — future capability (§15), not designed now

No pixel-level UI, component layout, or visual design is specified here —
that is future work following `DESIGN_SYSTEM.md`/`VISUAL_FOUNDATION.md`
once this product model is settled.

## 14. Trade Review integration

Per `JOURNAL_SPEC.md` §8, Trade Review's Process section must show, sourced
from the trade's associated Strategy Version snapshot (never the current
mutable Strategy definition):

```
Strategy: <name>
Version: v<N>
Review completeness: <M of K rules reviewed>
Compliance: <PASS / (PASS+FAIL) over evaluated, applicable rules>

Group A
  Rule A    PASS
  Rule B    FAIL

Group B
  Rule C    N/A
  Rule D    UNREVIEWED
```

Historical wording (group names, rule text) must always come from the
saved version snapshot (`STRATEGY_VERSIONING.md`), never from re-reading
the current live Strategy Version, even if the Strategy has since been
edited/republished past the version this trade used. `JOURNAL_SPEC.md`
already states this obligation at a document level (§8 there); this
section only adds the concrete UNREVIEWED-state and review-completeness
elements this checkpoint introduces.

A future editing workflow may allow marking/reviewing rules directly from
Trade Review rather than requiring a separate Strategy Builder visit — not
designed or implemented in this checkpoint.

**Checkpoint 015B:** implemented. Canonical Trade Review's Strategy tab lets
the trader (a) assign an exact published Strategy Version to an unassigned
Trade, one time, creating UNREVIEWED evaluations for that version's rules, and
(b) set PASS / FAIL / N/A / UNREVIEWED per rule through the existing
evaluation path. See `STRATEGY_ASSIGNMENT.md`.

## 15. Manual / system / hybrid evaluation

V1 must assume most Rules are **manually** evaluated — the trader looks at
the rule text and records PASS/FAIL/N/A themselves. Three future
conceptual evaluation sources, not implemented now:

- **MANUAL** — the trader explicitly evaluates the rule. The only source
  Solid Skill should assume broadly available in V1.
- **SYSTEM** — an objective condition computable reliably from data Solid
  Skill already normalizes (Trading Domain facts: account, symbol, time,
  direction, execution details, P&L). A future rule like "closed within 5
  minutes of open" could theoretically be system-evaluated because it only
  depends on data the Trading Domain already has — but note that even an
  example like this must remain user-configured data (a rule the user
  defines and opts into system-evaluation for), never a built-in Solid
  Skill concept.
- **HYBRID** — system proposes/derives a candidate state, but the trader
  reviews/confirms before it counts as evaluated (i.e., a system-derived
  value should not silently replace UNREVIEWED without trader confirmation,
  preserving the same "trader must actually look at it" principle behind
  §9's UNREVIEWED state).

Solid Skill must not claim to automatically infer subjective trading-
methodology judgment (e.g., "was directional bias respected") — that
requires trader judgment and stays MANUAL by nature. No automatic
rule-evaluation logic or AI inference is implemented in this checkpoint.

## 16. Explicit V1 non-goals

- No Strategy Builder UI implementation.
- No SQLite schema or persistence implementation.
- No Strategy Engine runtime/evaluation code.
- No condition-expression syntax, grammar, or evaluator.
- No graph/flowchart data model for dependencies.
- No automatic (SYSTEM/HYBRID) rule evaluation logic.
- No Behavior Analytics implementation (compliance-vs-outcome analytics,
  follow-rate stats) — this document defines the compliance figures that
  future analytics would consume, not the analytics themselves.
- No Missed Trades feature (§17).
- No strategy template/sharing infrastructure (§17).
- (Resolved in Checkpoint 009's consistency patch — see §9, §21.)

## 17. Future capabilities

- Version comparison (diff v1 vs. v2 vs. v3).
- A visual/diagrammable representation of rule structure and dependencies
  (`STRATEGY_ENGINE.md` already anticipates this).
- Required-rule-weighted compliance as a distinct metric alongside the
  unweighted V1 formula (§11).
- Rule-level analytics: follow rate, net P&L when passed vs. failed, profit
  factor, win rate — per the **[VERIFIED]** TradeZella rule-analysis
  reference (§2) — gated by `ARCHITECTURE.md`'s observation/emerging/
  statistically-meaningful-pattern discipline and never presented as
  causal.
- Multiple-strategy-per-trade (Model B from §12), if real usage justifies
  it.
- SYSTEM/HYBRID rule evaluation sources (§15).
- Missed Trades logging (§18) — explicitly deferred, not silently assumed.
- Strategy Instance vs. Strategy Template distinction, for future sharing
  (§19) — conceptually distinct but not designed here.
- Gamification hooks built on top of review-completion and compliance
  concepts (streaks for reviewing trades, completing process evaluation,
  following required process) — must reward process/discipline actions
  only, never P&L, trade count, position size, or anything that could
  incentivize overtrading (`CLAUDE.md` Absolute Rule 5). Not designed in
  this checkpoint; this document only confirms the Strategy/compliance
  concepts above are shaped so such a system could read from them later.

## 18. Missed trades — open question

**[VERIFIED]** TradeZella publicly supports missed-trade logging (a trade
the user considered/planned but did not take). Solid Skill V1 does **not**
add Missed Trades to the Strategy model. This is recorded as an explicit
open product question, not a rejected feature: does Solid Skill want a
"trade" concept that exists without any actual execution data, and if so,
does it get evaluated against Strategy rules the same way an executed
trade does? Left for a future checkpoint.

## 19. Templates / sharing — open question

Solid Skill should eventually support a user sharing a strategy as a
template another user can adopt. This requires distinguishing a **Strategy
Instance** (one user's actual, owned, versioned Strategy, per §4–§6 above)
from a future **Strategy Template** (a shareable, presumably de-identified
or genericized definition someone else can import as the starting point for
their own Instance). No collaboration infrastructure, template schema, or
sharing permission model is designed in this checkpoint — this section only
records that the two concepts must not be conflated when template/sharing
work eventually begins.

## 20. Open product questions

1. (Resolved in Checkpoint 009's consistency patch: UNREVIEWED is now
   formally part of `STRATEGY_ENGINE.md`'s Trade Rule Result definition. It
   applies prospectively — a trade's recorded historical Trade Rule
   Results are whatever states the trader actually left them in, per §5 of
   `STRATEGY_VERSIONING.md`'s immutability rule; UNREVIEWED does not
   retroactively apply to already-evaluated historical rules that predate
   this checkpoint's formalization.)
2. Should required-rule compliance (§11) become a second, explicit V1
   metric rather than a purely future one, once real usage data exists?
3. Should applicability conditions (§ Applicability / conditions) ever be
   allowed to reference another Strategy's rules/state, or must a Rule's
   conditions stay scoped to its own Strategy Version?
4. How does Strategy Compliance Over Time (§10) behave across a Version
   boundary — does it blend Trade Compliance figures from v1 and v2
   trades into one continuous series, or must it be presented per-version
   with an explicit seam, given the two versions may have different rule
   counts and even different rule meanings? (Also carried into
   `STRATEGY_VERSIONING.md` §13.)
5. If Model B (secondary strategy references, §12) is ever built, does a
   secondary strategy get its own Compliance figure, or is it purely
   informational/non-scoring?
6. Where does a system-derived HYBRID rule proposal (§15) live before
   trader confirmation — is it a visible "suggested" state distinct from
   UNREVIEWED, or does it just pre-fill the trader's input without
   changing the state label? Left for whenever SYSTEM/HYBRID evaluation is
   actually designed.
7. Missed Trades (§18) and Strategy Templates (§19) — both explicitly
   deferred, not designed here.

## 21. Contradictions / gaps identified against existing docs

Per this checkpoint's instruction to report rather than silently edit
protected documents:

- Resolved in Checkpoint 009's consistency patch: `STRATEGY_ENGINE.md`
  §"Trade Rule Result" now formally defines all four states (PASS, FAIL,
  N/A, UNREVIEWED) and the compliance-vs-review-completeness distinction,
  matching this document's §9–§10.
- No other contradictions were found. `STRATEGY_ENGINE.md`'s required/
  optional/conditional Rule kind, its Condition/Dependency concept, and its
  historical-immutability requirement are all consistent with, and were
  used as the basis for, §8, §9 (Applicability/Dependencies), and §10–§11
  of this document.
