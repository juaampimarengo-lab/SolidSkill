# Solid Skill — Strategy Engine

This document defines the conceptual model for Solid Skill's fully
user-configurable strategy/checklist system. This is one of the most
important documents in the repository: getting this wrong (by baking in a
specific trading methodology) would violate a fundamental product
constraint. This document does not finalize a database schema; it defines
the domain concepts a schema must eventually express.

## Fundamental rule

**No trading methodology may ever be hardcoded into the application.**

The application must not internally assume, model, or special-case concepts
such as: directional bias, CRT, ICT, SMT, liquidity sweep, FVG,
confirmation, opening range, VWAP, or any other named trading methodology or
technique. These are not application concepts. They are **user data**,
created through the Strategy Builder like any other rule a user might
invent.

If a future task asks to "add support for opening range" or similar, the
correct implementation is: nothing changes in application code. The user
creates a rule named "Opening range established" through the Strategy
Builder, exactly as they would create any other rule. The engine must not
know or care what the rule means semantically — only that it is a
condition a user defined, which trades can be evaluated against.

## Conceptual domain

```
Strategy
    ↓
Strategy Version
    ↓
Rule Group
    ↓
Rule
    ↓
Condition / Dependency
    ↓
Trade Rule Result
```

### Strategy

A named container for a trading methodology as defined by a single user.
Users may have multiple strategies (e.g., different approaches for
different instruments, sessions, or account types). A strategy is the
top-level unit that trades get associated with.

### Strategy Version

Strategies evolve. Every meaningful edit to a strategy's structure (rule
groups, rules, conditions, dependencies, ordering) produces a new **version**
rather than mutating history in place. A strategy version is the actual unit
that gets evaluated against a trade — "Strategy X" is really shorthand for
"whichever version of Strategy X was current when this trade was reviewed."

Old versions are retained indefinitely and remain evaluable/inspectable
even after newer versions exist.

### Rule Group

A logical grouping of related rules within a strategy version (e.g., a
group for entry criteria, a group for risk management, a group the user
labels however they like). Rule groups exist to organize rules for the
user's own readability and workflow — the engine treats them as containers,
not as anything semantically meaningful on its own.

### Rule

A single user-defined checklist item. A rule has, conceptually:
- A name/description, entirely user-authored free text/label.
- A kind: **required**, **optional**, or **conditional**.
- An order/position within its rule group, supporting an ordered workflow.
- Zero or more conditions/dependencies (see below).

The engine evaluates rules generically: was this rule satisfied for this
trade, yes/no (or not-applicable), based on how the user recorded/answered
it. The engine does not interpret what the rule *means*.

### Condition / Dependency

Rules can depend on other rules or on simple structural conditions (e.g.,
"only evaluate Rule B if Rule A was satisfied," or "at least N of these M
rules must be satisfied"). Dependencies allow the user to express workflow
logic — ordering, prerequisites, and branching — entirely through
configuration, without the application needing to understand the underlying
trading logic. Conditions are structural/logical, not methodology-specific.

### Trade Rule Result

When a trade is associated with a strategy version, each applicable rule
gets a Trade Rule Result whose state is one of:

- **PASS** — the rule was reviewed and satisfied.
- **FAIL** — the rule was reviewed and violated.
- **N/A** — the trader explicitly determined the rule does not apply to
  this trade. N/A is a deliberate judgment the trader made, never a
  stand-in for "not reviewed," "unknown," "forgotten," or "skipped."
- **UNREVIEWED** — the rule is applicable but the trader has not yet
  evaluated it. This is the default state for every applicable rule at the
  moment a trade is first associated with a strategy version, and it
  remains the state until the trader records PASS, FAIL, or N/A.

N/A and UNREVIEWED must never be conflated: N/A means the trader looked at
the rule and decided it doesn't apply; UNREVIEWED means the trader hasn't
looked yet. This is the atomic unit that Behavior Analytics consumes.

**Compliance vs. review completeness.** These are two distinct concepts and
must never be merged into one figure. *Compliance* is calculated only over
reviewed, applicable rules: `PASS / (PASS + FAIL)`, with N/A and UNREVIEWED
both excluded from the calculation. *Review completeness* is a separate
signal — whether every applicable rule has actually been reviewed (i.e.,
whether any UNREVIEWED rules remain). A trade with unresolved UNREVIEWED
rules must never be presented as fully reviewed, regardless of what its
compliance percentage among the rules reviewed so far happens to be. No
weighted compliance formula, and no use of P&L in this calculation, is
defined or implied here — see `STRATEGY_BUILDER_SPEC.md` for the full V1
compliance/review-completeness product specification.

## Future user-facing capabilities (to design toward, not to build now)

The Strategy Builder must eventually let a user create:
- Multiple strategies and multiple versions per strategy.
- Rule groups, with required, optional, and conditional rules.
- Dependencies between rules (prerequisites, "at least N of M," ordering).
- An ordered workflow representing the sequence a trader is meant to follow.
- A visual flow / diagram representation of a strategy version — a way to
  *see* the rule structure and dependencies, not just list them.

Two different users must be able to define completely unrelated
methodologies (e.g., User A: "Directional bias respected"; User B: "Opening
range established") and have the Strategy Engine treat both as nothing more
than user-created rules, evaluated the same generic way.

## Historical integrity

This is mandatory, not aspirational:

- When a trade is associated with a strategy and evaluated, Solid Skill must
  preserve the exact strategy version, the exact rule state that existed at
  the time of that evaluation, and each rule's recorded Trade Rule Result
  state (PASS, FAIL, N/A, or UNREVIEWED) exactly as the trader left it.
- Editing a strategy afterward (renaming rules, adding/removing rules,
  restructuring groups) must create a new strategy version and must **never**
  alter the historical Trade Rule Results already recorded against prior
  versions.
- Strategy-level presentation changes — display name, icon, color — do not
  by themselves create a new version, since they change nothing about what
  any rule asks the trader to do. Changes to a rule's meaning, wording,
  applicability, dependencies, or group membership do create a new version.
  Whether every possible Rule Group *rename* counts as a presentation
  change or a logic change remains an open product question, deliberately
  left unresolved here — see `STRATEGY_VERSIONING.md`.
- Any implementation (schema, migration, or code) that would allow a past
  evaluation to change as a side effect of editing the current strategy
  definition is a bug against this specification, regardless of how
  convenient it seems.

## Relationship to Behavior Analytics

The Strategy Engine's output (Trade Rule Results, tied to a specific
strategy version) is the primary input the Behavior Analytics Engine uses
to relate process compliance to trading outcomes — e.g., how trades perform
when a given rule is respected vs. violated, which rule violations
correlate with losing trades, or what happens when all mandatory rules are
respected. See `ARCHITECTURE.md` for the Behavior Analytics Engine's role
and its obligation to distinguish observation, emerging pattern, and
statistically meaningful pattern, and to never imply causation from
correlation or overstate small-sample findings.

The Strategy Engine itself does not perform this analysis — it only
produces the structured, historically faithful evaluation records that make
the analysis possible.

## Design implication for engineering

Because no methodology may be hardcoded, the Strategy Engine's schema and
code must be built around the generic concepts above (Strategy, Strategy
Version, Rule Group, Rule, Condition/Dependency, Trade Rule Result) with
free-form, user-authored content for names/descriptions/labels. Any urge to
add a typed enum of "known trading concepts," a special-cased rule type for
a specific methodology, or a built-in template that encodes a particular
trader's approach as if it were an application feature should be treated as
a violation of this document and avoided. Starter templates, if ever added,
must be presented and stored as ordinary user-editable strategy data, not as
privileged built-in application concepts.
