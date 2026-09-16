# Solid Skill — Trade Model Concepts

Checkpoint 006. This document defines, conceptually, the vocabulary the
Trading Domain and Normalization Layer (`ARCHITECTURE.md`) will eventually
use to represent trading activity. It draws no database schema, no SQL, and
no TypeScript interfaces. It exists so that Journal/Trade Review product
work (`JOURNAL_SPEC.md`) and future MT5/Tradovate normalization work share a
single vocabulary before either is implemented.

Everything here is a **[SOLID SKILL DECISION]** unless otherwise noted —
this document is internal domain modeling, not TradeZella research.

---

## 1. Order

A user's (or, historically, the platform's) instruction to a broker/platform
to buy or sell — not yet a fact about what happened in the market. An order
may be unfilled, partially filled, fully filled, cancelled, or rejected.

Solid Skill is a read-only consumer of order data for context (e.g., a
planned stop/target that was placed and later cancelled or modified is
still informative for process review). Solid Skill never originates,
modifies, or cancels an order — see `CLAUDE.md` Absolute Rule 1.

## 2. Execution / Fill / Deal

A concrete, immutable fact: this quantity, of this instrument, at this
price, at this timestamp, on this side (buy/sell), actually happened,
generally attributable to a specific source position (see §3) where the
platform exposes one. An execution is the atomic unit both Tradovate and
MT5 ultimately report, whatever they call it locally (Tradovate: fill; MT5:
deal).

Executions are the ground truth. Everything above this layer (Source
Position, Trade) is a *reconstruction* built from executions, not an
independently reported fact. A normalized execution is source-attributed
(see §14) but otherwise platform-agnostic before it reaches the Trading
Domain.

## 3. Source Position

The position concept as exposed or reconstructed from the source
platform. Its accounting behavior is not universal — it depends on the
account's/platform's position-accounting mode, which the future
normalization layer must capture per account rather than assume globally
(see §17).

Two modes exist, both of which Solid Skill must support without changing
its core Journal architecture:

- **Netting mode**: normally one running position per symbol per account.
  Its size and average price evolve execution by execution — it can grow
  via scale-in, shrink via partial exit, hit zero at flat, or, when an
  opposite-side execution exceeds the current size, flip sign into the
  opposite direction without passing through a separate flat state (a
  reversal — see the "Reversal segmentation" section below). This is the
  only mode Tradovate futures accounts use.
- **Hedging mode**: multiple independently identified source positions may
  coexist for the same symbol on the same account, including
  simultaneous opposite-direction positions (e.g., one LONG and one SHORT
  ticket open on the same symbol at once). Each source position has its
  own identity (e.g., an MT5 ticket) and its own independent lifecycle;
  executions apply to a specific source position, not to a single
  symbol-level ledger. MT5 accounts may run in either netting or hedging
  mode depending on broker/account configuration.

A source position is a continuous ledger, not a Solid Skill product object
on its own — it is the intermediate reconstruction step between raw
executions and a user-facing Trade. See §17/§18 for why source-position
tracking (not naive execution pairing) is required to get direction and
grouping right in both modes.

## 4. Trade

Solid Skill's normalized, user-facing analytical object, defined in
`JOURNAL_SPEC.md`, built from the appropriate execution/source-position
lifecycle for the platform and account mode it came from.

A Trade generally corresponds to one source-position lifecycle, but the
exact grouping rule is intentionally **not** fixed here. This document does
not define Trade as universally "one symbol's flat → open → flat cycle" —
that framing holds for the simple netting case but does not describe
hedging mode (where several source positions on the same symbol have
independent, overlapping lifecycles) or a netting reversal (where one
execution both closes one exposure and opens the opposite one — see below).
The precise mapping from source-position lifecycle to Trade boundaries
remains an open question for the future normalization layer, to be
resolved against real platform fixtures (§17, §18), not assumed here.

What is fixed: a Trade is not necessarily "one execution in, one execution
out." It may be composed of many executions on both the entry and exit
side. The example in Checkpoint 006 (two buy fills, then two sell fills, on
NQ, a netting-mode futures account) is one Trade with a scale-in and two
partial exits — never four independent trades. See `JOURNAL_SPEC.md`
§Trade Review for the full set of fields a reconstructed Trade must
eventually expose.

## 5. Direction

**Direction must never be inferred from the final execution's side.** It is
derived from the reconstructed Trade/source-position lifecycle and its
opening exposure, not from any single fill.

- BUY entry execution(s) + SELL exit execution(s) = **LONG**.
- SELL entry execution(s) + BUY exit execution(s) = **SHORT**.

The closing execution's side is definitionally the opposite side of the
exposure it closes — a SELL that closes a long exposure must never be
read as evidence the trade was short, and a BUY that closes a short
exposure must never be read as evidence the trade was long. Direction is
determined by which side *opened* the exposure, not by which side happens
to appear last in the execution list.

This rule must hold independently for each source position, including in
hedging mode where multiple simultaneous, independently-directioned source
positions exist for the same symbol on the same account at once — one
position's closing execution must never be read as evidence about another
position's direction.

This must become a mandatory future integration-test requirement for both
MT5 and Tradovate normalization (see §17, §18).

## 6. Scale-in

Additional entry executions, on the same side as the position's opening
execution, that increase the position's size while it remains open (before
it returns to flat). Each scale-in execution changes the average entry
price and total quantity but does not change direction or open a new trade.

## 7. Scale-out

The general case of reducing position size on the exit side while the
position remains non-flat and non-zero after the reduction. Scale-out and
partial exit describe the same underlying mechanism (see §8); "scale-out"
is used here as a symmetry term with "scale-in."

## 8. Partial exit

An exit execution whose quantity is less than the relevant source
position's current open quantity, leaving a smaller but still-open
position. A Trade may have zero, one, or many partial exits before its
final, fully-flattening exit execution. Each partial exit realizes a
portion of the trade's result at its own execution price and timestamp —
this is the mechanism behind `CALENDAR_SPEC.md` §11's requirement that a
single multi-day trade can contribute realized result to more than one
calendar day.

The final execution that returns that source position to exactly zero is
the trade's close; every exit execution before that is a partial exit. In
hedging mode (§3), this applies per source position independently — a
partial or complete exit on one source position must not affect another
simultaneously open source position on the same symbol (§17, hedging case
12).

## 9. Gross vs. net P&L

- **Gross P&L**: the raw result of entry vs. exit prices × quantity ×
  instrument value, before any costs are deducted.
- **Net P&L**: gross P&L minus commissions, fees, and (where applicable)
  swap. Net P&L is the economically real result to the trader.

Solid Skill must be able to represent both, since TradeZella's documented
Daily Journal stats (`TRADEZELLA_REFERENCE.md`) show Gross P&L and Net P&L
as distinct figures, and both are useful — gross for raw trade-management
skill, net for actual account impact.

## 10. Commissions / fees / swap

- **Commission**: a per-execution (or per-contract/per-lot) cost charged by
  the broker/platform for executing an order. Applies to both Tradovate
  fills and MT5 deals, though the unit and calculation differ per platform.
- **Fees**: any additional platform/exchange-level charge distinct from
  commission (e.g., exchange fees on futures).
- **Swap**: an MT5/CFD-specific overnight financing charge or credit for
  holding a position across a rollover point. Not applicable to Tradovate
  futures in the same form. Swap must be modeled as an optional,
  platform-conditional cost component — never assumed present, never
  hardcoded as futures-relevant.

All three must be attributable back to the specific execution(s) or holding
period that generated them, not just recorded as a single lump sum on the
Trade, so that gross-to-net reconciliation stays auditable.

## 11. Planned risk

The risk the trader intended to take on a trade before or independent of
its outcome — most commonly, the dollar or point/tick/pip distance from
planned entry to planned stop, multiplied by planned quantity. Planned risk
is process/planning data, not a fact derivable purely from executions; it
may be user-entered, or derived from a planned stop order if the platform
reports one and the user chooses to treat it as the plan.

## 12. Planned R

The trade's planned reward expressed as a multiple of planned risk
(§11) — e.g., a planned target that is 2× the planned stop distance is a
"planned 2R" trade. Planned R may involve multiple planned targets with
different quantities (see `JOURNAL_SPEC.md`), in which case a single
"planned R" figure is a simplification the UI must be explicit about, not
a single authoritative number silently computed from ambiguous inputs.

## 13. Realized R

The trade's actual result (net or gross — must be explicit which) expressed
as a multiple of the planned risk (§11) that was actually taken. Realized R
depends on planned risk having been recorded; a trade with no recorded
planned risk cannot have a realized R computed for it, and the product must
represent that as "not available," never as zero or an inferred guess.

## 14. Source identifiers

Every normalized execution must retain the identifier(s) the source
platform used for it (e.g., a Tradovate fill ID, an MT5 deal ticket),
carried through normalization as attribution metadata. Where the source
platform exposes one, the **source position ID/ticket** the execution
belongs to must also be preserved — this is not optional. In hedging mode
(§3), the source position ID is the only reliable way to tell which of
several simultaneous, possibly opposite-direction, positions on the same
symbol an execution belongs to; normalization must never discard or
collapse this identifier, since doing so would make it impossible to
distinguish or correctly close independent hedged positions.

Preserving both identifiers is required for:

- Deduplication (§15).
- Historical reconciliation (§16).
- Correctly attributing executions to the right source position in
  hedging mode, rather than accidentally merging unrelated position
  tickets into one reconstructed Trade.
- Auditability — being able to trace a Trading Domain execution (and the
  source position it belongs to) back to the exact platform record it
  came from.

Source identifiers are metadata on the normalized execution, not
broker-specific fields leaking into the Journal UI model
(`JOURNAL_SPEC.md` §Executions) — the UI shows normalized execution data;
the source identifiers travel with it for traceability, not for display as
a primary field.

## 15. Deduplication requirement

Both platforms can, under real-world conditions (reconnect, re-sync, replay,
manual re-import), redeliver an execution the system has already ingested.
Normalization must treat the source identifier (§14) as the basis for
idempotent ingestion: re-seeing the same execution ID must never create a
duplicate execution, a duplicate Trade, or double-counted P&L. This
document does not define the deduplication algorithm, only the requirement
that one must exist before either integration ships.

## 16. Historical reconciliation requirement

A user may connect an account with pre-existing history, restart the app,
or re-sync after time offline. The normalization/reconstruction layer must
be able to (re)build accurate Positions and Trades from a full historical
execution set, not just from a live incremental stream, and must produce
the same result whether history arrived all at once or incrementally over
time. This is a requirement on future design, not an algorithm defined
here.

## 17. MT5 cases to test later

Documented for the future MT5 normalization spike required by this
checkpoint. **Do not implement now.**

The future MT5 adapter must first capture/detect the account's
position-accounting mode (netting or hedging — §3) from the platform
itself, rather than assuming one globally across all MT5 accounts. All
cases below must be validated per mode.

**Netting:**

1. BUY in → SELL out = LONG.
2. SELL in → BUY out = SHORT.
3. Multiple BUY entries + partial SELL exits = one LONG trade.
4. Multiple SELL entries + partial BUY exits = one SHORT trade.
5. One position per symbol.
6. Scale-in.
7. Partial reduction (partial exit/scale-out).
8. Flatten (full close).
9. Reversal — an opposite-side execution larger than the current position
   size closes the existing exposure and opens exposure in the opposite
   direction on the same execution (see "Reversal segmentation" below).

**Hedging:**

10. Two simultaneous LONG source positions open on the same symbol at
    once.
11. Simultaneous LONG and SHORT source positions open on the same symbol
    at once.
12. Independent partial or complete closure of one source position by its
    source position ID/ticket (§14), with no effect on other open source
    positions on the same symbol.
13. No accidental merging of unrelated source position tickets into a
    single reconstructed Trade.

**Both modes:**

14. Duplicate event ingestion (§15).
15. App restart / historical reconciliation (§16).
16. Commissions.
17. Swap (§10).
18. Multiple symbols (concurrent positions/source positions must not
    cross-contaminate reconstruction).

## 18. Tradovate cases to test later

Documented for future Tradovate normalization. **Do not implement now.**

- Fills rather than assuming pre-grouped trades — Tradovate reports
  individual fills; grouping into Trades is Solid Skill's own
  reconstruction responsibility, not something the platform hands over
  pre-formed.
- Partial fills (a single order filling across multiple fill events).
- Scaling (in and out).
- Stable execution IDs (§14) surviving reconnects/re-syncs.
- Deduplication (§15) on re-delivered fills.
- Historical reconciliation (§16) after reconnect or re-import.
- Commissions/fees per fill.
- WebSocket reconnect behavior — fills that arrive out of order, late, or
  as a replayed backlog after a dropped connection must reconstruct to the
  same Position/Trade state as an uninterrupted stream.

## Reversal segmentation — an unresolved normalization question

Netting mode (§3) allows a single execution to both close an existing
position and open exposure in the opposite direction, without ever passing
through a flat state. Example:

```
LONG 1
SELL 2
→ resulting exposure: SHORT 1
```

This document does **not** decide how Solid Skill represents this case —
candidates include (but are not limited to) segmenting it into two
analytical Trades (one closing exactly at the reversal point, one opening
from it) or some other grouping model. This is explicitly left unresolved
and is carried into `JOURNAL_SPEC.md` §14 as an open product question. It
must be resolved during the future MT5 integration spike, against real
fixtures/tests (§17, case 9), not decided speculatively in this document.
Hedging-mode accounts do not have this ambiguity in the same form, since
opposite-direction exposure there is carried as separate source positions
rather than netted into one.
