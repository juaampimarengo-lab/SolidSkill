# Solid Skill — Strategy Versioning (V1)

Checkpoint 009. This document elaborates the Strategy Version lifecycle
introduced conceptually in `STRATEGY_ENGINE.md` ("Strategy Version" and
"Historical integrity") and `STRATEGY_BUILDER_SPEC.md` §5–§6: what a
Strategy Draft is, what makes a published Version, what creates a new
Version, and how historical Trade↔Version associations stay permanently
faithful. It is a conceptual and product specification, not a schema.

It contains no database schema, no SQL, no migration syntax, and no
TypeScript interfaces.

## Label legend

- **[VERIFIED]** — explicitly supported by current TradeZella public
  documentation.
- **[OBSERVED]** — visible in public/supplied TradeZella UI but not
  explicitly documented.
- **[SOLID SKILL DECISION]** — a product decision Solid Skill is making on
  its own, not a TradeZella fact.

**[SOLID SKILL DECISION — explicit boundary, restated from
`STRATEGY_BUILDER_SPEC.md` §2]** Everything in this document is a Solid
Skill product decision. TradeZella's public documentation does not
establish a comparable historical strategy-version architecture; nothing
here should ever be cited as a verified TradeZella capability.

---

## 1. Why versioning exists

A Strategy is not static — a trader refines their methodology over time.
But a trade's process evaluation is a historical fact: what the strategy
*required at the moment the trade was reviewed*. If editing a strategy
today silently changed what a trade reviewed six months ago shows as
"compliant," the entire premise of process analytics
(`ARCHITECTURE.md`'s Behavior Analytics Engine, `PRODUCT.md`'s core idea)
collapses — a trader could not trust that a compliance trend reflects
actual historical behavior rather than a rewritten rulebook. `CLAUDE.md`
Absolute Rule 3 makes this non-negotiable. Versioning is the mechanism that
makes "the strategy changed" and "history stays evidence" both true at
once.

## 2. Strategy identity vs. Strategy Version

Two distinct concepts, easy to conflate and important not to:

- **Strategy identity** — the durable container (`STRATEGY_BUILDER_SPEC.md`
  §4): a name, a description, a lifecycle state, a list of versions. "Buy
  the dip" the Strategy is one identity regardless of how many times its
  rules change.
- **Strategy Version** — one frozen, evaluable snapshot of that Strategy's
  rule structure at a point in time (`STRATEGY_BUILDER_SPEC.md` §6). "Buy
  the dip v3" is a specific, immutable set of Groups and Rules.

A Trade never references "the Strategy" in the abstract for evaluation
purposes — it always references a specific Version. "This trade used
Strategy Alpha" is shorthand; the precise, historically meaningful fact is
"this trade used Strategy Alpha v1."

## 3. Draft state

A **Draft** is the sole mutable working state for a Strategy
(`STRATEGY_BUILDER_SPEC.md` §5). Key properties:

- A Draft always starts from a copy of the current published Version's
  structure (or empty, if the Strategy has never published — §8).
- A Draft is never evaluated against trades. It has no historical standing
  and is not enumerable in Version History (`STRATEGY_BUILDER_SPEC.md`
  §13) until published.
- A Draft can be freely abandoned/discarded without any historical
  consequence, since nothing has referenced it yet.
- A Strategy has at most one active Draft at a time in V1 — not multiple
  parallel in-progress edits.
- Editing a Draft never touches the published Version it was copied from;
  they are separate objects from the moment the Draft is created, so
  concurrent read access to the published Version (e.g., a trade being
  reviewed against v3 while the user is drafting toward v4) is always safe
  by construction, not by convention.

## 4. Published / frozen version

Publishing turns the current Draft into a new, sequential, immutable
Version (v1, v2, v3, ...). At the moment of publish:

- The new Version becomes the Strategy's current published version.
- The Draft that produced it is consumed/closed — it no longer exists as a
  separate mutable object (a subsequent edit starts a *new* Draft from the
  just-published Version, per §3).
- All prior Versions remain exactly as they were; publishing never
  rewrites or removes them.
- The new Version is immediately eligible for evaluation against trades
  going forward — nothing about publishing itself touches past trades.

## 5. Historical immutability

Once **any** trade has been evaluated against a Version — i.e., at least
one Trade Rule Result exists referencing it — that Version's Groups,
Rules, applicability, and dependency structure must never change again,
under any circumstance, including:

- A user wanting to "just fix a typo" in a rule that already has history
  against it (§7 covers why even wording changes must go through a new
  Version once history exists).
- A migration or data-repair operation. Migrations may change *storage
  representation*, never the *historical meaning* of an already-evaluated
  Version.
- Archiving or attempting to delete the parent Strategy (§10) — archiving
  a Strategy must not cascade into altering or hiding its historical
  Versions' content.

This is the direct product expression of `CLAUDE.md` Absolute Rule 3 and
`STRATEGY_ENGINE.md`'s "Historical integrity" section applied specifically
to the versioning mechanism. Any future schema/migration design that would
make this violable — e.g., allowing in-place edits to a Version row once
any trade references it — is a bug against this specification regardless
of implementation convenience.

**Before any trade references a Version**, the Version is not yet
"historical" in this sense — but Solid Skill V1 does not need an
in-between mutable-published-but-unused state. A published Version is
immutable from the moment it is published, whether or not a trade has used
it yet; this is simpler to reason about than trying to track "has this
version accumulated history yet" as a gate on mutability, and it removes an
entire class of race condition (a trade being evaluated against a Version
at the exact moment someone tries to edit it in place).

## 6. Changes that create a new Version

**[SOLID SKILL DECISION]** The following are **logic changes** — they
always require a new Version (i.e., they can only be made via the Draft →
Publish flow, never as an in-place edit to a published Version):

- Add a Rule.
- Remove a Rule.
- Change a Rule's meaning/text (title or description) — even a "typo fix,"
  once the Version has any history, since Solid Skill has no reliable way
  to distinguish a cosmetic wording fix from a meaningful redefinition of
  what the rule asks for, and getting this wrong in the permissive
  direction would violate §5.
- Change a Rule's kind (required/optional/conditional —
  `STRATEGY_ENGINE.md`).
- Change a Rule's applicability/conditions.
- Reorder Rules, if order carries meaning for the Strategy (§ "reorder"
  note below).
- Add, remove, or restructure Rule Groups.
- Change dependencies between Rules.

**Reorder note:** `STRATEGY_ENGINE.md` describes Rule order as supporting
"an ordered workflow representing the sequence a trader is meant to
follow" — for a Strategy where order is meaningful (a sequence the trader
must follow), reordering is a logic change. Whether order is *always*
meaningful, or only when a Strategy's dependency structure makes it so, is
not fully settled — see §13 open questions. V1 should treat reordering as
a logic change by default (conservative — protects historical integrity)
rather than assuming it is always cosmetic.

## 7. Presentation changes vs. logic changes

**[SOLID SKILL DECISION]** The following are **identity/presentation
changes** — they may be applied to the Strategy directly, without creating
a new Version, because they do not change what any Rule asks the trader to
do or how any trade is evaluated:

- Strategy name.
- Strategy description.
- Strategy icon/color (per the **[VERIFIED]** TradeZella visual-identity
  reference, `STRATEGY_BUILDER_SPEC.md` §2).
- Strategy lifecycle state (active/archived — §10; this changes
  visibility/workflow status, not evaluation logic).
- Strategy list order (Checkpoint 015B, `STRATEGY_ASSIGNMENT.md` §8) — where
  the Strategy appears in the Strategies list. Never a Draft, never a Version.

These live on the Strategy identity (`STRATEGY_BUILDER_SPEC.md` §4), not on
any individual Version, which is precisely why they can change freely:
there is nothing per-Version to keep immutable about a name or a color.

**Ambiguous middle ground — explicitly flagged, not resolved:** a Rule
Group's *name* (e.g., renaming "Entry Criteria" to "Entry Checklist")
arguably changes nothing about evaluation, but §6 currently lists "add,
remove, or restructure Rule Groups" as a logic change without carving out
group *renaming* as presentation-only. This is treated conservatively in
V1: renaming a Group is a logic change requiring a new Version, on the same
reasoning as rule-text changes in §6 (no reliable way to distinguish a
cosmetic rename from a meaningful recategorization). This can be revisited
in a later checkpoint if it proves overly strict in practice (§13).

## 8. Draft → Publish lifecycle

```
Strategy Alpha
Current published version: v3

User clicks Edit
  → Draft created, copied from v3

User modifies rules
  → Changes remain in the Draft only; v3 is untouched and still what
    trades reference

User clicks Publish
  → v4 is created from the Draft's contents
  → v4 becomes the current published version
  → v1, v2, v3 remain exactly as they were, permanently
  → the Draft is consumed
```

**Never-published Strategy:** if a Strategy has never been published, it
has no current published Version, and (per §3) it cannot yet be associated
with or evaluated against any trade (`STRATEGY_BUILDER_SPEC.md` §12
requires a Trade to reference a specific Version). A brand-new Strategy is
therefore Draft-only and invisible to Trade↔Strategy association workflows
until its first Publish produces v1. This is a natural consequence of §3–§4
and needs no special-cased first-publish behavior beyond "v1 is the first
Version, same as any other."

## 9. Historical Trade snapshot relationship

A Trade's association with a Strategy (`STRATEGY_BUILDER_SPEC.md` §12)
must record, and permanently retain:

- The Strategy identity.
- The exact Strategy Version.
- The exact Rule Group / Rule definitions as they existed in that Version
  (i.e., reachable through the immutable Version — §5 — not through the
  live, possibly-since-changed Strategy).
- The per-rule Trade Rule Results (`STRATEGY_ENGINE.md`) evaluated against
  that Version's rules.

Displaying a historical trade (`JOURNAL_SPEC.md` §8, Trade Review's Process
section) must always resolve strategy/rule wording through the recorded
Version, never through "whatever the Strategy currently looks like."
`STRATEGY_BUILDER_SPEC.md` §14 shows the concrete Trade Review shape this
produces.

## 10. Deletion / archive semantics (conceptual)

**[SOLID SKILL DECISION]**

- **Archiving a Strategy** — removes it from active workflows (e.g., "pick
  a strategy for this trade" pickers, `STRATEGY_BUILDER_SPEC.md` §13
  Strategy List) but changes nothing about its historical data. Checkpoint
  015B refinement: the Trade Review assignment picker hides archived
  Strategies by default but keeps their published versions reachable behind
  an explicit "Show archived Strategies" toggle, because a late-reviewed
  Trade may genuinely have followed a since-retired methodology
  (`STRATEGY_ASSIGNMENT.md` §5). All past
  trades that reference any of its Versions continue to display exactly as
  before. Archiving is reversible (unarchive) and is a presentation-layer
  change (§7), not a logic change.
- **Deleting a Strategy** that has never been published, or whose Versions
  have never been referenced by any trade, is safe and unambiguous — there
  is no history to protect.
- **Deleting a Strategy (or a Version) that trades already reference** must
  never be allowed to silently orphan or corrupt those trades' historical
  process data. V1 should not implement hard deletion for any Strategy
  with trade history; Archive is the only removal-adjacent action exposed
  for such a Strategy. Whether a true "delete, with historical data
  retained independently of the live Strategy record" mechanism is ever
  needed is left as an open question (§13) rather than designed now —
  Archive already satisfies the practical need (hide from active use,
  preserve history) without the additional complexity of deciding what
  "delete but keep history" even means structurally.
- **Deleting a Draft** (§3) is always safe, since a Draft by definition has
  no history.

No migration/cascade mechanics are specified — this section documents the
product-level rule only.

## 11. Version comparison (future capability)

`STRATEGY_BUILDER_SPEC.md` §13/§17 already anticipates a future "compare
versions" capability in Version History. Conceptually, this would show
what changed between two Versions of the same Strategy (rules added/
removed/reworded, groups restructured, applicability changed) — useful both
for the trader's own understanding and potentially as an input to future
analytics that want to split a Strategy's performance history at a version
boundary (`STRATEGY_BUILDER_SPEC.md` §20 open question 4). Not designed or
implemented in this checkpoint.

## 12. Migration / compatibility considerations (conceptual)

Not a migration plan — conceptual considerations for whenever schema work
begins, per `ARCHITECTURE.md`'s Persistence Layer requirement that
"historical integrity" storage (strategy versions, rule snapshots, trade
rule results) be append-only or versioned:

- Whatever storage shape is chosen must make it structurally difficult (not
  just procedurally discouraged) to edit an already-referenced Version's
  content in place — e.g., favoring an append-only/snapshot storage
  pattern over a single mutable "current strategy" row, so that "editing
  history" would require an unusual, deliberate operation rather than an
  accidental one via a normal update path.
- A future schema migration that changes *how* versions are stored (e.g.,
  a storage format change) must be able to prove it preserves every
  existing Version's exact historical content and every existing Trade
  Rule Result's association — this is a acceptance criterion for any such
  migration, not an implementation detail to leave implicit.
- None of this is designed further in this checkpoint; it is recorded so
  that whoever eventually designs the schema starts from the right
  constraint set.

## 13. Open questions

1. Is Rule reordering always a logic change (§6), or only when a
   Strategy's structure makes order semantically meaningful (e.g., via
   dependencies)? Currently defaulted conservatively to "always a logic
   change."
2. Is renaming a Rule Group (§7's flagged ambiguous case) really
   equivalent to renaming a Rule's text, or should group names be treated
   more like Strategy name/description (pure presentation)? Currently
   defaulted conservatively to "logic change."
3. Does Solid Skill ever need a true "delete, but retain history
   independently" mechanism beyond Archive (§10), or does Archive fully
   cover the practical need indefinitely?
4. How should Strategy Compliance Over Time (`STRATEGY_BUILDER_SPEC.md`
   §10, §20 open question 4) present a Strategy's performance across a
   Version boundary — blended, or explicitly segmented per Version? This
   is jointly owned by this document and `STRATEGY_BUILDER_SPEC.md`.
5. Should Version publishing ever support an optional user-supplied note
   ("what changed in v4"), distinct from the structural diff a future
   Version Comparison (§11) could compute automatically? Not required for
   V1, worth considering once Version History UI is actually designed.
6. (Partially resolved in Checkpoint 009's consistency patch:
   `STRATEGY_ENGINE.md`'s "Historical integrity" section now explicitly
   distinguishes presentation changes from logic changes and cross-
   references this document. It still describes versioning only at the
   "meaningful edit produces a new version" level rather than adopting
   this document's Draft/Publish vocabulary verbatim — whether it should
   go further remains open.)
