# MT5 Normalization (Checkpoint 012B-1)

Pure, deterministic reconstruction of MT5 **raw deals** into **lifecycle
candidates**. Code: `src/main/integrations/mt5/normalizer/`. Input contract:
`MT5_RAW_DEAL_CONTRACT.md`. Nothing here is persisted yet (see §19).

> **READ-ONLY.** The normalizer consumes facts already received. It has no
> access to MT5, sockets, SQLite, or Electron, and no code path that could
> place, modify, cancel, or close anything. Solid Skill observes; it never
> controls the account.

## 1. Purpose

Turn `RawMt5Deal[]` + account context (`server`, `accountLogin`, accounting
mode) into:

- `completed` — proven, fully closed lifecycles (Trade **candidates**)
- `open` — lifecycles with remaining quantity > 0 (NOT Trades)
- `unresolved` — lifecycles that cannot be proven from the facts (withheld)
- `ignored` — non-trading deals / foreign-account deals
- `rejected` — deals that could not be interpreted safely
- `diagnostics`, `stats`

It is a **function**: same deal *set* → byte-identical result. No I/O, clock,
randomness, methodology, or strategy concept exists in the module (a smoke
test scans it).

## 2. Deal vs Source Position vs Solid Skill Trade

| Concept | What it is | Where |
| --- | --- | --- |
| Order | An instruction (`orderTicket` kept as provenance only) | not modeled |
| **Deal** | Immutable execution fact (`DEAL_TICKET`) | `RawMt5Deal` → `NormalizedExecution` |
| **Source Position** | MT5 lifecycle keyed by `DEAL_POSITION_ID` | reconstruction unit |
| **Solid Skill Trade** | Analytical object built from a *proven* lifecycle | `CompletedTradeCandidate` → (future) `Trade` |

The contract field `positionId` **is `DEAL_POSITION_ID`** — the position
identifier, not a position ticket, deal ticket, or order ticket. `"0"` means
“no position” and is never invented or substituted.

## 3. Canonical ordering

Arrival order is never consulted. Deals are sorted by `timeMsc`, then by the
**numeric** value of `dealTicket` (`"99" < "100"`; lexicographic order would
be wrong). Deduplication and grouping iterate in sorted/deterministic order,
so every list in the result is order-independent. Tests shuffle inputs (25
shuffles × every scenario, plus 200 seeded random books) and compare
`JSON.stringify` of the whole result.

`timeMsc` is `DEAL_TIME_MSC` **as reported — MT5 broker server time**, not
converted to UTC. See §19.

## 4. Hedging reconstruction (primary proven mode)

`RETAIL_HEDGING`: `(account, positionId)` is one independent lifecycle.
Never grouped by symbol. EURUSD position 100 LONG and EURUSD position 101
SHORT overlapping in time stay two lifecycles (test 6).

## 5. Direction rule

Direction comes **only from the opening deal** (`DEAL_ENTRY_IN`): BUY IN →
LONG, SELL IN → SHORT. A closing side never sets or changes direction: a
position whose first deal is an exit is `unresolved: MISSING_OPENING_DEAL`
(e.g. history window starts mid-trade), never a guessed direction. An entry
against the direction, or an exit with the direction, is unresolved.

## 6. Quantity accounting

Exact scale-8 `bigint` (the persistence fixed-point codec). Per lifecycle:
`opened`, `closed`, `remaining = opened − closed`. An exit larger than
`remaining` → `OVER_CLOSE`, lifecycle withheld; `remaining` is reported as it
stood *before* the offending deal, **never forced to zero**. An entry after
the id reached zero → `REOPEN_AFTER_CLOSE` (not guessed as a new lifecycle).
Completed ⇔ `remaining == 0`; open ⇔ `remaining > 0`.

## 7. Scale-in / scale-out

All deals of one `positionId` are one lifecycle: BUY, BUY, SELL, SELL → one
LONG Trade candidate with four executions. `avgEntryPrice` /`avgExitPrice`
are `Σ(q·p)/Σ(q)` over entries / exits, computed exactly in bigint and
rounded **half-up to scale 8**; `avgEntryPriceExact` / `avgExitPriceExact`
disclose whether rounding occurred. (`1@1.0850 + 1@1.0852 → 1.0851`, exact.)

## 8. Partial exits

`BUY IN 2, SELL OUT 1` → an `open` candidate (`remaining = 1`), never
`completed`. It carries direction, symbol, opened/closed/remaining quantity,
average entry/exit so far, **realized-so-far** gross/costs, executions so far,
`openedAtMsc`, `lastActivityAtMsc`. The next exit completes the *same*
`sourceLifecycleKey`. No production UI for open trades exists.

## 9. Execution mapping

Every trading deal in a proven lifecycle → `NormalizedExecution` with:
`source: 'MT5'`, `server`, `accountLogin`, `dealTicket`, `orderTicket`,
`positionId`, `sourceExecutionKey` (= `rawDealIdentity`: JSON
`["MT5", server, login, dealTicket]`), `sequence` (derived canonical position,
not identity), `executedAtMsc`, `side` BUY/SELL, `role` ENTRY/EXIT (from
`DEAL_ENTRY`), `quantity`, `price`, `profit` (source), `commission`, `fees`,
`swap`. Never derived from array indexes. `sourceExecutionKey` is the intended
future `Execution.sourceExecutionId`.

## 10. Costs / P&L

Preserved separately and never conflated: `profit`, `commission`, `fee`
(→ `fees`), `swap`.

- **Sign convention** = persistence convention: signed P&L contributions; a
  cost is negative. MT5 already reports costs this way; values pass through
  unchanged (no sign flipping).
- **Trade level** = exact sum over the lifecycle's deals of each category:
  `grossPnl = Σ profit`, `commission = Σ commission`, `fees = Σ fee`,
  `swap = Σ swap`.
- **null vs 0**: `null` = the source did not report it; `"0"` = a reported
  zero. A category is `null` on the Trade only when *no* deal reported it;
  otherwise it is the sum of the reported values (a deal reporting `null` next
  to one reporting `-3.5` contributes nothing, and stays `null` on that
  execution).
- `netPnl = grossPnl + commission + fees + swap` (null costs count as 0
  *inside the sum only*, matching `DATABASE_SCHEMA.md`). If **no** deal
  reported `profit`, `grossPnl` and `netPnl` are `null` — never an invented 0.
- No JS floating point anywhere in the calculation path.
- Costs booked as **separate** MT5 deals (DEAL_TYPE_COMMISSION* etc.) have no
  reliable position link and are ignored (§11); they are *not* attributed to
  trades. Whether the user’s broker uses them is a QA item (§18).

## 11. Non-trading deals

Only `DEAL_TYPE_BUY`/`SELL` can be executions. Known non-trading types
(BALANCE, CREDIT, CHARGE, CORRECTION, BONUS, COMMISSION*, INTEREST,
DIVIDEND*, TAX) → `ignored: NON_TRADING_DEAL_TYPE` with an `info`
diagnostic. **Unknown** `DEAL_TYPE` → `rejected: UNKNOWN_DEAL_TYPE` (error
diagnostic); never read as BUY/SELL. `BUY_CANCELED`/`SELL_CANCELED` → rejected
and, if they carry a position id, that lifecycle is withheld
(`CANCELED_DEAL_PRESENT`) because their effect is not modeled.
`DEAL_ENTRY` values other than IN/OUT/INOUT/OUT_BY (including the documented
`DEAL_ENTRY_STATE` status record) → `rejected: UNSUPPORTED_DEAL_ENTRY`, never
treated as an entry/exit, and the lifecycle is withheld. Other rejections:
non-positive/invalid volume or price, non-exact decimal, missing symbol,
`positionId "0"` on a trading deal. A rejected deal with a position id
withholds that whole lifecycle rather than producing a plausible-but-wrong
one.

## 12. OUT_BY (close-by)

`DEAL_ENTRY_OUT_BY` closes a position against an *opposite* position. The
raw deal alone does not say which counter position, nor how much volume each
gave up. Contract v1 does not carry that. → `unresolved: OUT_BY_UNSUPPORTED`
with `needs` naming the missing fact (the counter position identifier —
MQL5 exposes it on the order; **to be confirmed against a real capture** —
and per-position closed volumes). Both positions are withheld individually;
unrelated positions are unaffected (test 19). No guess.

## 13. INOUT / reversals

`DEAL_ENTRY_INOUT` (netting/exchange reversal) → `unresolved:
INOUT_NOT_PRODUCTION_PROVEN`. Real `DEAL_POSITION_ID` behavior across a
reversal has **not** been captured. The result preserves an
`InoutObservation` — deal quantity/side, prior direction and remaining
quantity, `candidateClosingQuantity`, `candidateReversalQuantity` — so the
closing and reversal portions are identifiable, **but nothing is emitted or
applied**. Also unresolved under hedging (unexpected). A leading INOUT has
prior state `null`.

## 14. Netting limitations

Netting/exchange use the same `DEAL_POSITION_ID` lifecycle rules for simple
IN/OUT (documented semantics; synthetic tests only). Additionally, two
time-overlapping lifecycles on one symbol contradict “one position per
symbol” and are both withheld (`NETTING_SYMBOL_OVERLAP`); hedging allows
that overlap. **Reversal segmentation is NOT production-proven**; netting/
exchange support is provisional until a real netting capture exists. The
hedging algorithm is not assumed universal.

## 15. Deterministic source lifecycle identity

`sourceLifecycleKey = JSON["MT5", server, accountLogin, positionId]`. No
segmentation id is used (none is genuinely required for supported cases).
This is **not** the Solid Skill Trade UUID; the future import service owns
UUID creation and maps the key to `Trade.sourceTradeId` /
`sourcePositionId`. The same lifecycle always yields the same key regardless
of other deals, arrival order, or completion state.

## 16. Idempotency / reconciliation

- Same deals again → identical result.
- Same deal twice (identical facts) → counted once, `DUPLICATE_DEAL_IGNORED`
  info diagnostic, `stats.duplicateDealsDropped`.
- Same identity, *different* facts → all versions withheld, `DEAL_CONFLICT`,
  lifecycle unresolved (order-independent; first-seen is not knowable here).
- Old + new deals → previously completed candidates are byte-identical; an
  open lifecycle keeps its key and becomes completed only when flat; new
  lifecycles appear only when closed (test 20).
- `planMt5Import(result, knownKeys)` (`importBoundary.ts`, **not invoked**)
  splits completed candidates into `toCreate` / `alreadyImported` and reports
  withheld open/unresolved counts.

## 17. Diagnostics / error philosophy

Prefer explicit *unresolved* over a plausible guess. Every non-happy path has
a machine code (`UnresolvedReason`, `RejectedReason`, diagnostic `code`),
a severity (`info`/`warning`/`error`), and — where a fact is missing — a
`needs` statement. Diagnostics carry tickets and position ids but never
prices, volumes, or unmasked account logins in log output. A withheld
lifecycle never blocks unrelated lifecycles.

## 18. Real-account QA status

- Proven at 012: real RETAIL_HEDGING account, 55/55 deals received,
  replay dedup works.
- Real snapshot QA is recorded in §18.1 below.
- Dev mechanism: `SOLID_SKILL_MT5_BRIDGE=1 SOLID_SKILL_MT5_DEV_SNAPSHOT=1
  npm run dev` writes, after each *complete* history sync, one
  pseudonymized snapshot per account to `<cwd>/.dev-data/mt5/`
  (`.gitignore`d). Opt-in, unpackaged builds only, no renderer/IPC exposure,
  fixed path (nothing from MT5 chooses a path/filename). Login/server are
  replaced by one-way pseudonyms; `externalId` (free text) is dropped; no
  credentials are ever held. Tickets/times/prices are kept so structure can be
  analyzed locally — the file is private and must never be committed.
- Then: `npm run qa:mt5-snapshot` prints **structure only** (deal counts, type/
  entry distributions, unique position ids, completed/open/unresolved,
  unresolved reasons, INOUT/OUT_BY counts, masked account). It normalizes in
  memory and persists nothing.
- Fixtures derived from real captures must be anonymized (identifiers,
  shifted timestamps) while preserving numeric relationships.

### 18.1 Real snapshot QA result (structure only)

The pure normalizer was run over one real, pseudonymized raw snapshot from a
real `RETAIL_HEDGING` MT5 account (via `npm run qa:mt5-snapshot`, in memory,
nothing persisted). The snapshot lives only in the gitignored `.dev-data/`
directory and is not, and must never be, committed. No account number, server
identity, tickets or private history are recorded in this document.

| Measure | Result |
| --- | --- |
| Raw deals received | 55 |
| Unique deal identities / duplicates dropped | 55 / 0 |
| Trading deals / non-trading deals / rejected | 54 / 1 / 0 |
| Unique source position ids | 27 |
| Deal types | BALANCE 1, BUY 27, SELL 27 |
| Deal entries | IN 27, OUT 27 |
| INOUT / OUT_BY deals | 0 / 0 |
| Completed / open / unresolved lifecycles | 27 / 0 / 0 |
| Unresolved reasons | none |

Conclusions:

- The real snapshot normalized cleanly: 27 source position ids became 27
  completed lifecycle candidates, with no unresolved or rejected trading
  lifecycle.
- The single BALANCE deal was correctly classified as non-trading.
- Every position in this sample is one IN deal plus one OUT deal.

This proves the current normalizer works on this real RETAIL_HEDGING sample.
It does **not** prove:

- real scale-in / scale-out (none present; covered synthetically only)
- real partial exits (none present; covered synthetically only)
- real OUT_BY / close-by (none observed)
- real INOUT / netting reversal (none observed)
- live `OnTradeTransaction` normalization (only history deals were tested)
- every broker's commission representation (only this broker's booking)

Real coverage must not be overstated; the synthetic suites remain the only
evidence for the behaviors listed above.

## 19. What remains before persistence / import

1. ~~Run the real snapshot through the normalizer~~ — done for one
   RETAIL_HEDGING sample, see §18.1 (structure only; limitations listed there).
2. Import service: Solid Skill UUIDs, account mapping (`accounts` row for the
   MT5 account), idempotent upsert by `sourceLifecycleKey`, transactional
   write through `TradeRepository`. (Likely no migration; decide then.)
3. **Time semantics**: `DEAL_TIME_MSC` is broker server time. Needs a server
   UTC-offset/timezone decision before `openedAt`/`closedAt` and
   `analyticalTradeDate` are derived.
4. Symbol/instrument mapping and any point-value/tick knowledge (P&L is taken
   from MT5 `DEAL_PROFIT`, not recomputed).
5. Real netting/exchange capture to prove reversal segmentation; real OUT_BY
   capture (+ counter-position id in contract v2 if needed).
6. Policy for open lifecycles on import (withheld now) and for lifecycles
   whose opening deal predates the synchronized window.
7. Confirm how the broker books commission (per-deal vs separate commission
   deals).

## 20. Explicit read-only invariant

No `CTrade`, `OrderSend`, SL/TP modification, or open/close/cancel command
exists in the EA or anywhere in Solid Skill; the receiver never writes to the
socket; the normalizer performs no I/O. Enforced by the MT5 smoke suite and
by the normalizer smoke suite's source scan.
