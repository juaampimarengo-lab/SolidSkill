# Tradovate Integration Spike — Read-Only Adapter & Contract Discovery

Checkpoint 013. An engineering spike, mirroring the shape of the MT5 spike
(`MT5_INTEGRATION_SPIKE.md`) but for Tradovate, initially for the user's Apex
futures account. It does **not** persist real Tradovate history. Raw fact
contract: `TRADOVATE_RAW_CONTRACT.md`. Code:
`src/main/integrations/tradovate/`.

> **Checkpoint 013B** (`docs/TRADOVATE_REAL_QA.md`) added the first REAL
> (HTTP) `TradovateTransport` implementation (`realTransport.ts`) and a
> gated, manual real-connectivity QA command
> (`npm run dev:tradovate-real-qa`). Everything below this notice describes
> the 013 spike as originally built (fake transport + synthetic fixtures
> only); it remains accurate for the adapter/normalizer boundary, which 013B
> did not change. See `TRADOVATE_REAL_QA.md` for what 013B added and its
> result (blocked: no real credentials were available in that environment).

> **READ-ONLY.** Solid Skill's Tradovate integration must never place,
> modify, cancel, or close an order, move a stop/target, or flatten a
> position, even though Tradovate's real API does expose such endpoints.
> This is enforced by the adapter's type surface, not by caller discipline
> — see "Proof the adapter is read-only" below.

## 1. Purpose

```
Tradovate API (REST + WebSocket)
    ↓
Tradovate Adapter        src/main/integrations/tradovate/adapter.ts
    ↓
raw Tradovate source facts    TRADOVATE_RAW_CONTRACT.md
    ↓
Tradovate Raw Staging     src/main/integrations/tradovate/rawStaging.ts (in-memory)
    ↓
Tradovate Normalizer      src/main/integrations/tradovate/normalizer/ (pure)
    ↓  ── not built yet ──
future Tradovate Import Service → Trading Domain → SQLite
```

Everything below the normalizer line is future work and does not exist.
Nothing in this checkpoint persists a real Tradovate Trade; the normalizer's
output (`completed` / `open` / `unresolved` candidates) is proven only
against synthetic fixtures and a fake transport.

## 2. Why Tradovate is not MT5-shaped

The MT5 integration transports **raw deals over a custom loopback TCP
protocol Solid Skill itself designed** (an EA the user compiles and runs).
Tradovate is the opposite shape: Solid Skill is a client of Tradovate's own
REST + WebSocket API. Consequently:

- There is no "EA" to write; the adapter is an HTTP/WebSocket client.
- The wire format is Tradovate's, not Solid Skill's — this checkpoint
  documents what was found in official/community sources (`TRADOVATE_RAW_CONTRACT.md`
  §1), explicitly flagging what is unconfirmed, rather than inventing a
  contract the way the MT5 EA's wire format was designed from scratch.
- Futures accounts on Tradovate run **one net position per (account,
  contract)** — there is no confirmed hedging-mode analogue to MT5's
  `RETAIL_HEDGING` (multiple simultaneous opposite-direction positions on
  the same symbol). This checkpoint does not assume MT5's hedging/netting
  duality applies to Tradovate; see "Position/lifecycle identity" below.

Per `CLAUDE.md` and the checkpoint brief: Tradovate gets its own adapter,
its own raw-fact contract, and its own normalizer. **No Tradovate fact is
ever fed through the MT5 normalizer, the MT5 protocol types, or MT5 raw
staging** (verified by inspection: `src/main/integrations/tradovate/` has
zero imports from `src/main/integrations/mt5/`, and the reverse).

## 3. Official API evidence consulted

**Updated by the 013 official-contract audit (2026-09-22).** The first spike
pass leaned on community/forum material for historical-fill reliability and
for the FillPair/FillFee schemas. This audit re-sourced those directly from
the official Tradovate Partner API reference (`partner.tradovate.com`); see
`TRADOVATE_RAW_CONTRACT.md` §1 for the full page-by-page source list.
Summary, with the audit's corrected confidence tiers:

| Topic | Source | Confidence |
|---|---|---|
| `accessTokenRequest` / `renewAccessToken` fields, token lifespan, session limits, official renewal guidance | `partner.tradovate.com` auth endpoint pages | **PROVEN BY OFFICIAL DOCS** |
| Demo/live REST base URLs, WebSocket host names | Same / API cheat sheet | **PROVEN BY OFFICIAL DOCS** |
| Fill, FillFee, Position, FillPair, Order — full field schemas | `partner.tradovate.com` entity reference pages (fetched individually, 2026-09-22) | **PROVEN BY OFFICIAL DOCS** (schema); real-account behavior of each remains its own open question — see `TRADOVATE_RAW_CONTRACT.md` §5–§9 |
| Generic REST entity operations (`item`/`items`/`list`/`find`/`suggest`/`deps`/`ldeps`) | `partner.tradovate.com` cheat sheet + `llms.txt` full index | **PROVEN BY OFFICIAL DOCS** |
| `user/syncrequest` request shape, `entityTypes` gating behavior | `partner.tradovate.com` WebSocket core-concepts page | **PROVEN BY OFFICIAL DOCS** (request shape); frame/response shape is **UNPROVEN UNTIL REAL ACCOUNT ACCESS** |
| Write endpoints exist (`place-order`, `cancel-order`, `modify-order`, `liquidate-position(s)`, `place-oco`/`place-oso`) | `llms.txt` full index | **PROVEN BY OFFICIAL DOCS** (used only to confirm what to positively exclude — §7) |
| One real user's empty-results experience calling `fillPair/list`/`fill/list`/`order/list`, and Tradovate support's suggested Reporting-API pattern | Tradovate community forum thread | **Secondary note only** — does not establish or negate endpoint existence; see `TRADOVATE_RAW_CONTRACT.md` §5a |

No credentials were available or invented for this spike (see §12, "Real
access gate"). Nothing here should be read as "proven against a live
account" the way several MT5 findings are (`MT5_INTEGRATION_SPIKE.md` §10a,
§18.1) — every schema claim above is **PROVEN BY OFFICIAL DOCS**, not by
exercising a real Tradovate session.

## 4. Auth / session findings

- `POST /auth/accesstokenrequest` (demo: `https://demo.tradovateapi.com/v1/...`,
  live: `https://live.tradovateapi.com/v1/...`) with a credentials body
  (`name`, `password`, `appId`, `appVersion`, `cid`, `sec`) returns a Bearer
  `accessToken`, an `expirationTime`, `userId`, and account-capability flags
  (`hasLive`, `hasSimPlus`).
- Token lifespan is reported as **80 minutes** by the authoritative endpoint
  documentation (one older community source says 90 minutes — this
  discrepancy is not resolved here; **80 minutes is treated as the
  authoritative figure** since it comes from the endpoint's own
  documentation page, not a secondary summary). `POST /auth/renewAccessToken`
  extends it; Solid Skill's adapter should renew well before expiry (the
  `TradovateSession.expiresAtMsc` field exists for exactly this).
  `renewSession` in `transport.ts` exists as a first-class capability so a
  real implementation cannot skip building it.
- **Sessions are limited to 2 concurrent** — a new `accessTokenRequest`
  closes the oldest. This has product implications (a real integration must
  not silently re-authenticate in a way that kicks out the user's own
  Tradovate desktop/mobile session) that are out of scope for this spike but
  are recorded here for the next one.
- **Never sent, never logged:** password, `sec` (API secret). No credential
  is stored anywhere in this repository — `TradovateCredentials` exists only
  as an in-memory parameter shape.

## 5. Account model

`RawTradovateAccount` (`protocol.ts`) carries the source account id, name,
owning `userId`, `accountType`, `active`, `clearingHouseId`, `legalStatus`.
A Tradovate user may have multiple accounts (`listAccounts()` returns all of
them); nothing assumes exactly one. See `TRADOVATE_RAW_CONTRACT.md` §4 for
the schema-confidence caveat.

## 6. Adapter interface

`src/main/integrations/tradovate/adapter.ts`, exactly the conceptual shape
requested:

```ts
connect(credentials) -> Promise<void>
listAccounts() -> Promise<readonly RawTradovateAccount[]>
getHistoricalSourceFacts(accountId, range) -> Promise<readonly RawTradovateFill[]>
subscribeToSourceFacts(accountId) -> void   // + unsubscribeFromSourceFacts(accountId)
disconnect() -> Promise<void>
```

It depends only on `TradovateTransport` (`transport.ts`), an interface a
real HTTP/WebSocket client implements. Swapping the underlying client
library never touches `adapter.ts`, the normalizer, or (eventually)
persistence — the same replaceability guarantee `ARCHITECTURE.md` requires
of every adapter.

## 7. Proof the adapter is read-only

Enforced by construction, not by discipline:

- `TradovateTransport` (`transport.ts`) has **no method** that places,
  modifies, or cancels an order, or flattens/modifies a position or
  bracket/stop/target. `TradovateAdapter` can only call methods that exist
  on this interface, so it is **structurally incapable** of sending a
  trading instruction, regardless of what a real client library's own SDK
  might expose elsewhere.
- `npm run smoke:tradovate` includes a static source scan (mirroring the MT5
  smoke suite's `.mq5` scan) over every `.ts` file under
  `src/main/integrations/tradovate/`, failing the whole suite if any
  trading-capability pattern appears (`placeOrder(`, `cancelOrder(`,
  `modifyOrder(`, `flattenPosition(`, `liquidatePosition(`,
  `order/placeorder`, `order/cancelorder`, `order/modifyorder`,
  `position/flattenposition`, `position/liquidateposition`, and variants).
  This test is in the required matrix (item 22) and passes today.
- No renderer IPC channel exists for Tradovate at all (mirrors the MT5
  integration's IPC boundary — `IPC_CONTRACT.md`, "MT5 bridge is not part of
  this contract"). `window.solidSkill` is untouched by this checkpoint.
- `FakeTradovateTransport` (the only implementation that exists today) also
  has no write-capable method — it could not accidentally demonstrate
  trading capability even by accident in a test.

## 8. Source fact types

See `TRADOVATE_RAW_CONTRACT.md` in full. Summary: `RawTradovateAccount`,
`RawTradovateContract`, `RawTradovateOrder` (provenance only — an Order is
not an execution; official fields corrected in the audit, §8 of the raw
contract), `RawTradovateFill` (the ground-truth execution fact, Tradovate's
analogue of an MT5 deal; its official schema has **no `accountId` and no
cost/P&L fields** — corrected in the audit, §5 of the raw contract), plus
three **reconciliation-only** entities added by the audit:
`RawTradovatePosition`, `RawTradovateFillPair`, `RawTradovateFillFee` (§6–§9
of the raw contract). None of the three reconciliation entities is consumed
by `normalizer/normalize.ts` — this is a structural guarantee, not just
documentation, that they cannot silently become Trade identity or Trade
cost data.

## 9. Fill identity

Stable identity = `["Tradovate", accountId, fillId]` (`rawFillIdentity()`).
Not identity: timestamp, contract, arrival order, or array index — same
discipline as the MT5 deal identity rule
(`MT5_RAW_DEAL_CONTRACT.md` §7), independently implemented for Tradovate
(`rawStaging.ts` does not import from `mt5/rawDealStaging.ts`).

## 10. Order identity

`orderId` is preserved on every fill purely as provenance (Order ≠ Fill,
per `TRADE_MODEL_CONCEPTS.md` §1–2); it is never used as fill identity and
never becomes fill/trade identity on its own. Case 5/9 in the synthetic
matrix (two fills sharing one `orderId`, e.g. a split-fill entry) is covered:
they still correctly merge into one lifecycle by contract, not by order.

## 11. Position/lifecycle identity — corrected by the 013 audit

**This is the most important item in this checkpoint**, and the 013 audit
required a real correction here, not just re-documentation.

MT5's raw deal carries `DEAL_POSITION_ID`, an explicit, documented
per-execution position ticket that survives partial fills and is the
reconstruction key. **No confirmed, officially documented equivalent
per-fill field exists for Tradovate** — the official Fill entity has no
position-ticket field at all (`TRADOVATE_RAW_CONTRACT.md` §5), and the
official Position entity (§6 of the raw contract) is a **per-(account,
contract, tradeDate) daily accounting snapshot**, not a single
continuously-updated lifecycle ticket. Tradovate futures accounts run one
net position per (account, contract) — structurally closer to MT5's
`RETAIL_NETTING`/`EXCHANGE` modes than to `RETAIL_HEDGING`.

**GROUPING KEY != DURABLE TRADE IDENTITY.** The audit found the original
spike's `(accountId, contractId)` bucket was **too coarse to ever become a
durable identity**, for a concrete reason: a single account/contract can
have many independent flat → position → flat round trips over time (buy
one MNQ contract in the morning and close it, then buy and close another
one in the afternoon — two completely separate analytical Trades). The
original algorithm did not model this correctly — it either would have
merged both round trips into one lifecycle, or (in an earlier draft) treated
the second round trip's opening fill as an erroneous "reopen after close."
**Both were wrong**, and the audit's synthetic test
("grouping key != durable identity: two independent round trips on the same
account+contract stay separate", `tradovateSmoke.ts`) proves the corrected
behavior: two round trips on the identical (account, contract) produce
**two independent completed candidates**, never merged.

**Corrected design:** `(accountId, contractId)` remains a **TEMPORARY
grouping bucket** used only to scope which fills can possibly belong
together, but the normalizer (`normalize.ts`, `reconstructBucket()`) walks
each bucket's fills in canonical chronological order and starts a **new,
independent segment** every time the running exposure returns to exactly
flat and a further fill arrives. Each segment's `sourceLifecycleKey` is
`JSON["Tradovate", accountId, contractId, openingFillId]` — anchored to
**that specific round trip's own opening fill id**, deliberately not a
position-in-sequence counter. This choice was deliberate: a counter-based
key would silently renumber (and thus invalidate an already-persisted
identity for) an existing round trip if an earlier one is discovered later
by an expanded historical fetch, whereas anchoring to the opening fill's own
stable Tradovate id cannot shift under reordering. A companion test
("a later reversal never erases an earlier, already-completed round trip on
the same account+contract") proves a later problem (a reversal) never
retroactively invalidates an earlier, already-flat, already-completed
segment.

**This remains explicitly a TEMPORARY policy, not a durable Trade
identity**, per the audit's instruction. `normalizer/types.ts` carries an
extensive warning on `sourceLifecycleKey` for exactly this reason. **Before
any real import**, this must be validated against real account evidence:
does Tradovate expose any stronger per-fill or per-round-trip linkage (via
`FillPair.positionId`, or otherwise) that would let reconstruction be keyed
more precisely than "this segment's own opening fill id"? Unknown; not
assumed either way — see `TRADOVATE_RAW_CONTRACT.md` §7 for what FillPair
can and cannot currently prove.

## 12. Real access gate

**No credentials were required, invented, or exercised in this checkpoint**,
per the brief. The entire adapter, staging, and normalizer are proven with:

- `FakeTradovateTransport` (`fakeTransport.ts`) standing in for a real
  HTTP/WebSocket client.
- Synthetic fill fixtures (`__smoke__/fixtures.ts`) standing in for real
  Tradovate history.

**Manual next step for a real connectivity test** (not performed here):

1. Obtain Tradovate demo credentials and, separately, Partner API
   application credentials (`appId`/`appVersion`/`cid`/`sec`) — Tradovate's
   API access model requires an approved application, not just a trading
   account (`https://support.tradovate.com/s/article/Tradovate-API-Access`).
2. Store them in local environment variables only (e.g.
   `SOLID_SKILL_TRADOVATE_NAME`, `SOLID_SKILL_TRADOVATE_PASSWORD`,
   `SOLID_SKILL_TRADOVATE_APP_ID`, etc.) — never committed, never hardcoded,
   following the same discipline as `SOLID_SKILL_MT5_BRIDGE_KEY`.
3. Implement one real `TradovateTransport` (a genuinely new class; nothing
   in `adapter.ts` would need to change) using `fetch`/`ws` against the demo
   REST/WebSocket hosts in §3.
4. Call `listAccounts()` and `getHistoricalSourceFacts()` against the demo
   account and confirm which historical-fill endpoint actually returns data
   (§5's open question), and whether `RawTradovateFill.timestamp` really is
   UTC ISO-8601 as documented.
5. Only after that evidence exists should the position/lifecycle-identity
   assumption in §11 be revisited and the reversal-segmentation question be
   attempted.

`isTradovateAdapterEnabled()` (`index.ts`) documents the intended
environment-gate shape (mirroring `SOLID_SKILL_MT5_BRIDGE`) but is
deliberately inert in this checkpoint: it reads one flag and always permits
nothing further, because no real transport exists yet to gate.

## 13. Fill identity, Order identity, Position/lifecycle identity

Covered in §9–§11 above.

## 14. Instrument identity

`contractId` + `contractName` are preserved verbatim (`TRADOVATE_RAW_CONTRACT.md`
§8). A dated contract (`MNQZ6`) is never collapsed into a continuous/generic
symbol — case 21 in the synthetic matrix proves this. No point-value or
tick-size knowledge is modeled (mirrors MT5 import's stance: P&L is taken
from the source, not recomputed from tick value — `MT5_IMPORT.md` §11).

## 15. Timestamp semantics

See `TRADOVATE_RAW_CONTRACT.md` §10. Summary: preserved exactly as reported
(`timestamp`, documented `datetime` type, plus the official `tradeDate`
`{year,month,day}` reassembled as "YYYY-MM-DD"); documented convention is
UTC ISO-8601, a potentially stronger guarantee than MT5's
broker-server-clock milliseconds, but **not independently confirmed**
against a real payload in this spike. No session/analytical-date policy is
decided.

## 16. LONG reconstruction rule

Direction comes **only from the fill that moves this segment's exposure
from FLAT into non-zero** — i.e. the segment's own `openingFillId`: a Buy
opening exposure → LONG (`normalizer/normalize.ts`). Proven synthetically
(matrix cases 1, 3, and the explicit "direction inversion regression" tests
in `tradovateSmoke.ts`): a LONG lifecycle's closing SELL never flips the
recorded direction, and — per the §11 correction — a LATER round trip on
the same (account, contract) never inherits or contaminates an earlier
round trip's direction either.

## 17. SHORT reconstruction rule

Symmetric: a Sell fill that moves a segment from flat into non-zero exposure
→ SHORT (cases 2, 4). A SHORT lifecycle's closing BUY never flips the
recorded direction (explicit regression test).

## 18. Protection against direction inversion

This was the checkpoint's named **critical history** item (a prior journal
implementation sometimes reported LONG as SHORT and vice versa). Guarded
three ways:

1. **Structurally**: `direction` is set exactly once, from the very first
   fill processed for a lifecycle (`reconstruct()` in `normalize.ts` — the
   `if (direction === null)` branch), and is never reassigned by a later,
   opposite-side fill; opposite-side fills only ever `close`/`reduce`/flag a
   reversal.
2. **By canonical ordering, not arrival order**: fills are sorted by
   timestamp then numeric fill id (`compareFillsCanonically`) before
   reconstruction, so a fill delivered out of order (case 14) or with a
   duplicate/misleading timestamp (case 15) cannot masquerade as the
   opening fill.
3. **By explicit regression tests** in `tradovateSmoke.ts`
   ("direction inversion regression: a closing SELL never makes a LONG read
   as SHORT" / the BUY/LONG symmetric case) that assert the exact failure
   mode described in the checkpoint's "Critical history" section cannot
   recur.

## 19. Partial-fill behavior

A fill whose quantity is less than the lifecycle's current remaining
exposure closes part of it and leaves the lifecycle `OPEN` (case 7,
`PARTIAL_EXIT_STAYS_OPEN`) — never a fabricated completed Trade, and never
an independent "fake" Trade per partial exit, satisfying the checkpoint's
explicit requirement.

## 20. Scale-in behavior

Additional same-side fills before the lifecycle returns to flat increase
`openedQuantity` and the volume-weighted `avgEntryPrice`, without changing
direction (case 6/8, `SCALE_IN_PARTIAL_OUT`; case 5/9,
`MULTI_FILL_ONE_ORDER` additionally proves this holds even when the entry
fills share one `orderId`).

## 21. Scale-out behavior

Symmetric: additional same-side-as-exit fills before flat are tracked as
partial exits contributing to `closedQuantity` and the volume-weighted
`avgExitPrice` (case 6/8).

## 22. Reversal behavior / unresolved cases

**Deliberately not segmented.** An opposite-side fill whose quantity exceeds
the current segment's remaining exposure (a candidate netting reversal,
cases 18 and 19) halts **that segment** as
`unresolved: REVERSAL_NOT_PRODUCTION_PROVEN`. A
`TradovateReversalObservation` preserves the fill side/quantity and the
prior direction/remaining quantity, and computes
`candidateClosingQuantity`/`candidateReversalQuantity` **as observations
only** — nothing is applied or emitted as a Trade. This mirrors the MT5
normalizer's `INOUT_NOT_PRODUCTION_PROVEN` policy
(`MT5_NORMALIZATION.md` §13) and is required because, per §11 above, real
Tradovate reversal semantics (does the platform report this as one fill
against a continuing lifecycle, or does it internally treat it as
close-then-reopen?) have not been captured from a live account.

**Correction from the audit:** a reversal only halts the segment it occurs
in. A round trip on the same (account, contract) that already returned to
flat **before** the reversal fill stays a valid, untouched `completed`
candidate — proven by "a later reversal never erases an earlier,
already-completed round trip on the same account+contract"
(`COMPLETED_ROUND_TRIP_THEN_REVERSAL` fixture). This directly follows from
the §11 segmentation correction: prior segments are already finalized
independent records by the time a later segment's reversal is discovered.

## 23. Replay/dedup behavior

Identity = `["Tradovate", accountId, fillId]`. Same identity + identical
facts → `duplicate`, counted once (`TradovateRawStaging`, case 12, proven at
both the staging layer and the normalizer layer — `stats.duplicateFillsDropped`).

## 24. Conflict behavior

Same identity + **different** facts → `conflict`: the first-seen record is
kept, nothing is overwritten, and the affected lifecycle is withheld as
`unresolved: FILL_CONFLICT`/rejected as `FILL_CONFLICT` at the normalizer
level (case 13). Mirrors `MT5_RAW_DEAL_CONTRACT.md` §7's conflict policy,
independently implemented.

## 25. Multi-account isolation

`TradovateRawStaging.listForAccount()` and the normalizer's `account`
parameter both scope strictly by `accountId`; a fill belonging to a
different account is excluded with an `ACCOUNT_MISMATCH` diagnostic and
never enters another account's lifecycle reconstruction (case 10, two
accounts holding opposite-direction lifecycles on the identical contract at
the identical timestamps, proven independent). Apex is never hardcoded
anywhere in the adapter — see §26.

## 26. Apex / prop-firm separation

Nothing in `src/main/integrations/tradovate/` mentions Apex, any other
prop-firm name, or any prop-firm-specific rule. The adapter models
"a Tradovate account" only; which accounts are prop-firm evaluation
accounts, funded accounts, or personal brokerage accounts is a future
Accounts/Prop-Firm-layer concern, per `CLAUDE.md` Absolute Rule 2 (no
methodology/business concept hardcoded below its proper layer) and the
checkpoint's explicit instruction.

## 27. Cost / P&L findings — corrected by the 013 audit

**Corrected finding:** the official Fill entity has **no** realized-P&L,
commission, or fee field at all (`TRADOVATE_RAW_CONTRACT.md` §5) — the
original spike draft's `realizedPnl`/`commission`/`fees` fields on
`RawTradovateFill` did not match the official schema and have been
**removed**. That data instead lives on two officially documented,
separately modeled entities:

- `RawTradovateFillPair` (official fields: `positionId`, `buyFillId`,
  `sellFillId`, `qty`, `buyPrice`, `sellPrice`, `active`) — Tradovate's own
  realized buy/sell matching record. **Not automatically the Solid Skill
  Trade** (`TRADOVATE_RAW_CONTRACT.md` §7); real semantics (partial exits,
  one fill in multiple pairs, FIFO vs. other matching) are unconfirmed.
- `RawTradovateFillFee` (official fields: `clearingFee`, `exchangeFee`,
  `nfaFee`, `brokerageFee`, `ipFee`, `commission`, `orderRoutingFee`, each
  with its own currency id) — each independently nullable, proven
  synthetically to preserve null-vs-zero distinctly per category ("FillFee
  preserves each fee/commission category independently, null distinct from
  zero"). **The official FillFee entity has no `fillId` field**
  (`TRADOVATE_RAW_CONTRACT.md` §9a) — the Fill↔FillFee linkage itself is
  unresolved, so `RawTradovateFillFee.attributedFillId` is explicitly named
  and explicitly nullable to signal an adapter-side attribution attempt, not
  a confirmed join.

**Consequence:** `normalizer/normalize.ts` computes **no cost/P&L figure at
all** in this checkpoint (no `grossPnl`/`commission`/`fees`/`netPnl` on any
lifecycle candidate) — this is more honest than guessing a join that isn't
confirmed. Cost/P&L attribution is deferred to a future checkpoint gated on
resolving §9a against a real account, ideally the user's Apex account
specifically (a prop-firm account's fee categories may differ from a
personal brokerage account's).

## 28. Historical retrieval findings — corrected by the 013 audit

**Corrected finding.** The original spike draft overstated this as broadly
uncertain based on community evidence alone. The audit re-sourced this
directly from official docs: **`GET /v1/fill/list` (and `fill/item`,
`fill/deps`) are officially documented endpoints — their existence is
proven, not uncertain** (`TRADOVATE_RAW_CONTRACT.md` §5).

What remains genuinely open is **real-account sufficiency**, not endpoint
existence: retention depth, whether the Apex-provisioned API key/account
exposes the full history Solid Skill needs, and whether `fill/list` alone
(no documented date-range parameters) is practically sufficient for a
long-lived account (`TRADOVATE_RAW_CONTRACT.md` §5a). The community forum
report (empty results for one real user, Tradovate support's suggested
Reporting-API pattern) is now recorded as a **secondary note** about one
account's real-world experience, not as evidence about the documented
endpoints themselves. `TradovateTransport.listHistoricalFills` remains
written against the capability, not a hardcoded endpoint, so a real
implementation can target `fill/list` first and fall back only if real
testing shows it necessary.

## 29. Live-event findings

Tradovate's real-time model is a `user/syncrequest`-style WebSocket
subscription (name confirmed to exist; exact frame shape not independently
verified in this spike). `TradovateTransport.subscribeToFills` models this
as "give me a callback for new fills on this account," deliberately
abstracting away whatever the real frame format turns out to be — the
adapter and normalizer are unaffected by that detail once a real transport
implements it. Proven synthetically only (`FakeTradovateTransport.emitLiveFill`,
smoke test "adapter: live subscription stages fills through the same path as
history"): live fills stage through the identical `TradovateRawStaging` path
history fills do, so there is only one dedup/conflict implementation to
reason about, never two.

## 29a. Position / FillPair audit

Added by the 013 audit, per its explicit instruction to determine what
these official entities can and cannot prove, without guessing.

- **Position** (`TRADOVATE_RAW_CONTRACT.md` §6): a per-(account, contract,
  tradeDate) daily accounting snapshot (`netPos`, `bought`, `sold`,
  `prevPos`, …), not a lifecycle ticket. `Position.id` is **never** used as
  a Solid Skill Trade identity — `normalizer/` does not import
  `RawTradovatePosition` at all, a structural guarantee. Its useful role is
  as a **future reconciliation fact**: a real account's daily `netPos` could
  be cross-checked against the normalizer's own from-fills running
  exposure, entirely independent of how Trades get segmented.
- **FillPair** (`TRADOVATE_RAW_CONTRACT.md` §7): Tradovate's own realized
  buy/sell matching record. **Not automatically the Solid Skill Trade.**
  Five explicit open questions are recorded (partial-exit generation,
  one-Position-many-FillPairs, one-Fill-many-FillPairs, provider-accounting
  vs. analytical-grouping, and credential/scope parity with Fill) — none are
  answered by guessing; all are marked **UNPROVEN UNTIL REAL ACCOUNT
  ACCESS**. `normalizer/` does not import `RawTradovateFillPair` either.
  This normalizer's own deterministic exposure accounting (§11, §16–§22)
  remains the sole source of lifecycle segmentation until FillPair's real
  semantics are confirmed against Apex data.

## 30. Privacy / secrets behavior

- `TradovateCredentials` (`transport.ts`) exists only as an in-memory
  parameter type; nothing in this repository stores, logs, or serializes a
  password or API secret. No `.env`, config file, or committed fixture
  contains a real or plausible-looking credential.
- Log-friendly event summaries (`describeTradovateAdapterEvent` in
  `index.ts`) mask account ids to their last three characters
  (`***514`-style, matching the MT5 masking convention) and never include a
  password, token, or full account id.
- No OS-level credential-store integration was built in this spike (per the
  brief: "do not build a large credential manager... unless necessary" —
  it was not necessary, since no real transport exists yet to hold a live
  session). The future real-transport checkpoint should investigate
  Electron's `safeStorage` or the OS keychain before ever persisting a
  Tradovate session token to disk.

## 31. Localization

This checkpoint introduces no renderer-visible product string. Every new
identifier, comment, and diagnostic message is developer-facing (log lines,
diagnostics, TypeScript types), consistent with `CLAUDE.md`'s localization
rule and `LOCALIZATION.md`. `src/renderer/` is untouched.

## 32. Synthetic test matrix — coverage

All 22 originally required cases plus the audit's additional regression
tests are implemented in `src/main/integrations/tradovate/__smoke__/` and
pass via `npm run smoke:tradovate` (**32 assertions total**): simple
long/short, direction not inverted by the closing fill (both directions),
multiple entry fills, a single order producing multiple fills, scale-in,
scale-out/partial exit, partial exit leaving an open lifecycle, two isolated
accounts, two isolated instruments, identical-replay dedup,
conflicting-duplicate rejection, out-of-order fact resolution,
same-timestamp deterministic tie-break (numeric fill id), open lifecycle,
closed lifecycle, LONG→SHORT and SHORT→LONG reversal conservatism, source
contract identity preservation, and the no-trading-capability static scan
— **plus, added by the audit:** two independent round trips on the same
account+contract stay separate (§11), a later reversal never erases an
earlier completed round trip (§22), Position.id preserved as provenance only
(§29a), FillPair preserves buy/sell fill ids without becoming Trade identity
(§29a), and FillFee preserves each fee/commission category independently
with null distinct from zero (§27).

The `MISSING_FINANCIALS` case from the original draft no longer applies:
Fill carries no financial fields at all (§27), so null-vs-zero preservation
is now proven at the FillFee level instead.

## 33. Success definition — status

- ✅ A Tradovate-specific read-only adapter boundary exists
  (`adapter.ts` + `transport.ts`).
- ✅ No trading method exists anywhere (§7, statically enforced).
- ✅ Authoritative API semantics documented directly from official Tradovate
  Partner API pages, with uncertainty stated explicitly only where real
  evidence is genuinely required (§3, §11, §27, §28, §29a).
- ✅ Stable source identities identified for fills (§9); order and
  account identities preserved as provenance (§4, §10).
- ✅ Raw source facts represented independently of canonical Trades
  (`protocol.ts`, `rawStaging.ts` — nothing here is a `Trade`/`Execution`
  persistence row).
- ✅ LONG/SHORT reconstruction explicitly protected against inversion (§18).
- ✅ Partial fills/scaling/out-of-order/replay covered synthetically (§32).
- ✅ Uncertain reversal cases remain explicit, not guessed (§22).
- ✅ Multiple accounts/instruments remain isolated (§25).
- ✅ No real Tradovate history persisted (nothing in this checkpoint writes
  to SQLite at all — the normalizer's output never reaches
  `TradeRepository`).
- ✅ All existing QA stays green (see "QA" below).

## What is explicitly NOT proven by this checkpoint

- Nothing here has been exercised against a real Tradovate account or real
  credentials of any kind — every schema claim is **PROVEN BY OFFICIAL
  DOCS**, not by a live session.
- Real-account sufficiency of `fill/list` for full history (retention depth,
  Apex-key scope) is unconfirmed (§28).
- The `(accountId, contractId, openingFillId)` lifecycle-identity policy
  (§11) remains explicitly TEMPORARY and is unconfirmed against any
  stronger real per-fill/per-round-trip linkage Tradovate may expose.
- Real reversal semantics are unconfirmed (§22).
- Real FillPair semantics — partial exits, one-fill-in-many-pairs,
  provider- vs. analytical-grouping — are unconfirmed (§29a).
- The FillFee↔Fill linkage mechanism is unconfirmed
  (`TRADOVATE_RAW_CONTRACT.md` §9a); consequently no cost/P&L figure is
  computed anywhere in this checkpoint (§27).
- Tradovate's real JSON field types (`double`/`integer`/`long` per the
  official docs) and the resulting transport-boundary decimal conversion are
  unimplemented and untested against a real payload
  (`TRADOVATE_RAW_CONTRACT.md` §15).
- No normalizer/importer exists that could ever write a Tradovate Trade to
  SQLite — that is explicitly out of scope for this checkpoint and requires
  the evidence above first.

## QA

Run: `npm run smoke:tradovate` (32/32 as of 013; 45/45 as of 013B — see
`TRADOVATE_REAL_QA.md`), `npm run smoke:persistence` (111/111), `npm run
smoke:mt5` (38/38), `npm run smoke:mt5-normalizer` (35/35), `npm run
smoke:mt5-import` (39/39), `npm run smoke:mt5-reconciliation` (22/22), `npm
run smoke:i18n` (22/22), `npm run qa:active-account` (17/17), `npm run
typecheck`, `npm run build`. All pass. MT5 behavior is completely unchanged —
`src/main/integrations/tradovate/` has zero imports from and zero imports
into `src/main/integrations/mt5/`.
