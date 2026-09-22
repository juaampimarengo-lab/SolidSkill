# Tradovate Raw Source Fact Contract (spike v1, audited)

Checkpoint 013 (spike), tightened by the 013 official-contract audit
(2026-09-22). Defines the raw, platform-shaped facts the future Tradovate
adapter reads before any normalization. Reference implementation:
`src/main/integrations/tradovate/protocol.ts`. Context and decisions:
`TRADOVATE_INTEGRATION_SPIKE.md`.

> **Checkpoint 013B** (`docs/TRADOVATE_REAL_QA.md`) attempted to validate
> every "PROVEN BY OFFICIAL DOCS" claim below against a real account and
> could not: no real Tradovate credentials were available in that
> environment (see `TRADOVATE_REAL_QA.md`, "Result: BLOCKED"). Every schema
> claim in this document therefore remains exactly what it was at the end of
> 013 — proven against official documentation, **not** against a live
> response. Nothing below was changed by 013B.

> **READ-ONLY.** This contract describes facts Solid Skill *reads* from
> Tradovate. It defines no operation that can place, modify, cancel, or close
> anything, and the adapter/transport interface (`transport.ts`) has no
> write-capable method for anything in this document to flow into.

Every field below is labeled with its evidence tier:

- **PROVEN BY OFFICIAL DOCS** — read directly from a current
  `partner.tradovate.com` endpoint reference page (§1).
- **PROVEN SYNTHETICALLY** — implemented and exercised by
  `npm run smoke:tradovate` against a fake transport and fixtures; correct
  *given the official schema*, but never executed against a live account.
- **UNPROVEN UNTIL REAL ACCOUNT ACCESS** — a genuine open question that only
  a real Tradovate account (ideally the user's Apex account) can answer. No
  credentials were used to answer these; they are recorded as explicit
  blockers.

## 1. Evidence and sources (audit pass, 2026-09-22)

The original spike (013, first pass) leaned on community/forum material for
several claims that official documentation actually answers directly. This
audit re-sourced the following **directly from
`https://partner.tradovate.com`**, the official Tradovate Partner API
reference:

| Entity / topic | Official page |
|---|---|
| Fill (single + list) | `.../api/rest-api-endpoints/orders/fill-item.md`, `.../fill-list.md` |
| Fill dependents | `.../api/rest-api-endpoints/orders/fill-dependents.md` |
| FillFee (single + list) | `.../api/rest-api-endpoints/orders/fill-fee-item.md`, `.../fill-fee-list.md` |
| Position (single + list) | `.../api/rest-api-endpoints/positions/position-item.md`, `.../position-list.md` |
| FillPair (single + list) | `.../api/rest-api-endpoints/positions/fill-pair-item.md`, `.../fill-pair-list.md` |
| Order (single + list) | `.../api/rest-api-endpoints/orders/order-item.md`, `.../order-list.md` |
| accessTokenRequest | `.../api/rest-api-endpoints/authentication/access-token-request.md` |
| renewAccessToken | `.../api/rest-api-endpoints/authentication/renew-access-token.md` |
| user/syncrequest (WebSocket) | `.../overview/core-concepts/web-sockets/user-syncrequest.md` |
| Full endpoint index | `https://partner.tradovate.com/llms.txt` |

The full endpoint index (`llms.txt`) additionally confirms the generic REST
verb pattern (`item`, `items`, `list`, `find`, `suggest`, `deps`,
`l-deps`/`ldeps`) applies uniformly across `fill`, `fillFee`, `fillPair`,
`position`, `order`, and `account`, and — separately, and NOT wrapped by
this integration (see §12) — confirms the existence of real write endpoints
(`place-order.md`, `cancel-order.md`, `modify-order.md`,
`liquidate-position.md`, `liquidate-positions.md`, `place-oco.md`,
`place-oso.md`, and the order-strategy family).

Community/forum material (the original spike's primary source for §5) is
now demoted to a **secondary note only**, per the audit's instruction, and
is used solely to record one real user's observed account-access
experience — it is not treated as documentation of the endpoint's existence
or absence.

## 2. Contract / version

Every raw fact carries `contractVersion: 1` (`TRADOVATE_CONTRACT_VERSION`),
a Solid Skill-internal shape-versioning convention (mirroring the MT5 raw
contract's `v: 1`), not a Tradovate wire protocol.

## 3. Transport — PROVEN BY OFFICIAL DOCS

- REST base URLs: `https://demo.tradovateapi.com/v1` and
  `https://live.tradovateapi.com/v1` (confirmed on the `accessTokenRequest`
  page).
- User-data WebSocket: `wss://demo.tradovateapi.com/v1/websocket` /
  `wss://live.tradovateapi.com/v1/websocket` (Partner API cheat sheet).
- A separate market-data WebSocket and market-replay WebSocket exist but
  carry quotes/DOM data, not account/execution facts — out of scope.

## 4. Account — PROVEN BY OFFICIAL DOCS (existence/shape); UNPROVEN (full field fidelity against a live response)

`RawTradovateAccount` (`protocol.ts`): `id`, `name`, `userId`,
`accountType`, `active`, `clearingHouseId`, `legalStatus`. The
`account/list` endpoint's existence and generic shape are confirmed by the
official index; the exact full field list was not independently
re-confirmed field-by-field the way Fill/Order/Position/FillPair/FillFee
were in this audit pass (those five got a dedicated page fetch each; Account
did not, this round). Treat the current field list as reasonable but not
re-verified to the same standard as §5–§9 below.

## 5. Fill — PROVEN BY OFFICIAL DOCS

**Corrected finding.** The original spike draft stated historical Fill
retrieval was "critically uncertain" based on a community forum report. That
overstated the uncertainty: **the official `GET /v1/fill/list` (and
`fill/item`, `fill/deps`) endpoints exist and are documented.** Endpoint
*existence* is not in question.

Official Fill entity (from `fill-list.md` / `fill-item.md`, confirmed
2026-09-22) — **exactly these fields**:

| Field | Type | Required |
|---|---|---|
| `orderId` | long | Yes |
| `contractId` | long | Yes |
| `timestamp` | datetime | Yes |
| `tradeDate` | `{year, month, day}` | Yes |
| `action` | enum ("Buy"\|"Sell") | Yes |
| `qty` | integer | Yes |
| `price` | double | Yes |
| `active` | boolean | Yes |
| `finallyPaired` | integer | Yes |
| `id` | long | No |

**Two corrections this made to `RawTradovateFill` (`protocol.ts`):**

1. **The official Fill entity has NO `accountId` field, directly or
   nested.** The original spike draft wrongly modeled `accountId` as if it
   were native to Fill. It is now documented as **ADAPTER-ATTRIBUTED**: a
   real transport must resolve it via `orderId` → `Order.accountId` (Order
   *does* officially carry `accountId` — confirmed, §8). `RawTradovateFill`
   still carries an `accountId` field for Solid Skill's own
   account-scoped staging, but the type doc now says explicitly that this
   is a join Solid Skill performs, not a fact Tradovate hands over on the
   fill itself.
2. **The official Fill entity has NO realized-P&L/commission/fee field.**
   The original draft's `realizedPnl`/`commission`/`fees` fields on
   `RawTradovateFill` were **fabricated relative to the official schema**
   and have been **removed**. That data lives on separate, officially
   documented entities (`RawTradovateFillPair`, `RawTradovateFillFee` — §6,
   §9), which are now modeled as their own raw facts, never folded into
   Fill.

`RawTradovateFill` now also carries the official `tradeDate`, `active`, and
`finallyPaired` fields verbatim (previously omitted).

### 5a. What remains genuinely uncertain about historical retrieval

Endpoint *existence* is proven; **sufficiency for Solid Skill's needs is
not**, and this is the correct scope for continued uncertainty (per the
audit's "endpoint existence vs. real-account sufficiency" distinction):

- **UNPROVEN UNTIL REAL ACCOUNT ACCESS:** retention depth (how far back
  `fill/list` actually returns data — not documented in the pages
  consulted, and **not invented here**).
- **UNPROVEN UNTIL REAL ACCOUNT ACCESS:** whether the Apex-provisioned
  API key/account will have permission to read the full Fill/Order/Position
  history Solid Skill needs (prop-firm API access is sometimes scoped
  differently from a personal brokerage account — not documented, not
  assumed).
- **UNPROVEN UNTIL REAL ACCOUNT ACCESS:** whether `fill/list` alone (an
  unfiltered "all fills" call, per the documented shape — no date-range
  parameters were found on the page) is practically sufficient, or whether
  pagination/range behavior forces a different strategy for a long-lived
  account.
- **Secondary note only** (community forum,
  `community.tradovate.com/t/how-to-retrieve-historical-fills-trades-via-oauth/12607`):
  one developer reported empty arrays from `fillPair/list`/`fill/list`/
  `order/list` on an account with real completed trades, and Tradovate
  support pointed them at a separate Reporting API
  (`rpt-live.tradovateapi.com`) for historical backfill plus
  `user/syncrequest` for real-time. This is **not** evidence the documented
  endpoints don't exist (they do — §1); it is evidence that *some* accounts
  may need a different retrieval path in practice, which is exactly the
  kind of "real-account sufficiency" question in this section, not an
  "endpoint existence" question.

`TradovateTransport.listHistoricalFills` (`transport.ts`) remains written
against the capability ("get historical fills for an account in a range"),
not hardcoded to one endpoint, so a real implementation can target
`fill/list` first and fall back to the Reporting API pattern only if real
testing shows it is necessary.

## 6. Position — PROVEN BY OFFICIAL DOCS (schema); NOT a Trade identity

Official Position entity (`position-list.md`, confirmed 2026-09-22):

| Field | Type | Required |
|---|---|---|
| `accountId` | long | Yes |
| `contractId` | long | Yes |
| `timestamp` | datetime | Yes |
| `tradeDate` | `{year, month, day}` | Yes |
| `netPos` | integer | Yes |
| `bought` | integer | Yes |
| `boughtValue` | double | Yes |
| `sold` | integer | Yes |
| `soldValue` | double | Yes |
| `prevPos` | integer | Yes |
| `id` | long | No |
| `netPrice` | double | No |
| `prevPrice` | double | No |

**Reading of what this proves and does not prove:**

- This is a **per-(account, contract, tradeDate) accounting snapshot** — it
  has a `tradeDate` and `prevPos`/`netPos` fields, consistent with a daily
  rollup row, not a single continuously-updated position ticket with a
  stable lifecycle-spanning id (unlike MT5's `DEAL_POSITION_ID`).
- **`Position.id` is NOT automatically the Solid Skill Trade identity**, per
  the audit's explicit instruction. Nothing in `normalizer/` imports or
  references `RawTradovatePosition` — this is a structural guarantee, not
  just a documentation promise, that Position facts cannot silently become
  lifecycle identity.
- **Useful as:** a provenance / reconciliation fact — a daily net-position
  snapshot that a future reconciliation step could cross-check the
  normalizer's own running `netPos` against, entirely independent of how
  Trades are segmented.
- **UNPROVEN UNTIL REAL ACCOUNT ACCESS:** whether `netPos`/`bought`/`sold`
  on a real account's daily snapshot would actually match the normalizer's
  own from-fills reconstruction (a strong reconciliation signal if so), and
  whether Tradovate ever represents more than one Position row per
  (account, contract, tradeDate) under any account configuration.

`RawTradovatePosition` (`protocol.ts`) models exactly the official fields
above; `rawPositionIdentity()` exists only for the tests proving this fact
type stays a provenance record, never a lifecycle key.

## 7. FillPair — PROVEN BY OFFICIAL DOCS (schema); real semantics unproven

Official FillPair entity (`fill-pair-list.md`, confirmed 2026-09-22):

| Field | Type | Required |
|---|---|---|
| `positionId` | long | Yes |
| `buyFillId` | long | Yes |
| `sellFillId` | long | Yes |
| `qty` | integer | Yes |
| `buyPrice` | double | Yes |
| `sellPrice` | double | Yes |
| `active` | boolean | Yes |
| `id` | long | No |

**CRITICAL, per the audit: FillPair is NOT automatically the Solid Skill
Trade.** `RawTradovateFillPair` (`protocol.ts`) models these fields exactly
and is never consumed by `normalizer/normalize.ts` (same structural
guarantee as Position, §6). It is read as: *Tradovate's own record of one
matched buy fill against one sell fill*, most plausibly reflecting the
provider's own realized-P&L accounting (likely FIFO; not confirmed) rather
than necessarily Solid Skill's analytical Trade grouping.

**Open questions, explicitly unanswered by the official pages consulted —
UNPROVEN UNTIL REAL ACCOUNT ACCESS, per the audit's instruction not to
guess:**

- Is a FillPair generated for a partial exit, or only for a fill that fully
  closes some quantity?
- Can one Position have multiple FillPair rows (e.g. one per partial
  close), and if so, in what order/relationship to each other?
- Can a single Fill participate in more than one FillPair record (e.g. a
  multi-lot entry fill matched against several separate exit fills)?
- Does FillPair reflect the *provider's* internal matching convention
  (which may be FIFO, LIFO, or something account-configuration-dependent)
  rather than the user's own analytical grouping intent?
- Is FillPair history available under the same credentials/scopes as Fill,
  or could it be restricted differently (relevant to the Apex-provisioned
  key)?

Consequently: **FillPair is documented here as a potential future
reconciliation/realized-matching signal, and explicitly NOT used to
determine Trade boundaries, direction, or segmentation in this checkpoint's
normalizer.** The normalizer's own deterministic exposure accounting
(§"Direction" in the spike doc) remains the sole source of lifecycle
segmentation until FillPair's real semantics are confirmed.

## 8. Order — PROVEN BY OFFICIAL DOCS (schema, corrected)

Official Order entity (`order-list.md`, confirmed 2026-09-22):

| Field | Type | Required |
|---|---|---|
| `accountId` | long | Yes |
| `timestamp` | datetime | Yes |
| `action` | enum ("Buy"\|"Sell") | Yes |
| `ordStatus` | enum (Canceled, Completed, Expired, Filled, PendingCancel, PendingNew, PendingReplace, Rejected, Suspended, Unknown, Working) | Yes |
| `admin` | boolean | Yes |
| `id` | long | No |
| `contractId` | long | No |
| `spreadDefinitionId` | long | No |
| `executionProviderId` | long | No |
| `ocoId` | long | No |
| `parentId` | long | No |
| `linkedId` | long | No |

**Correction:** the original spike draft's `RawTradovateOrder.orderType`
field does not exist on the official Order entity and has been **removed**.
`RawTradovateOrder` now models `accountId` (confirmed required — this is
the join Solid Skill uses to attribute a Fill to an account, §5),
`contractId` (optional), `action`, `ordStatus`, `timestamp`.

## 9. FillFee — PROVEN BY OFFICIAL DOCS (schema); linkage unresolved

Official FillFee entity (`fill-fee-list.md`, confirmed 2026-09-22):

| Field | Type |
|---|---|
| `id` | long |
| `clearingFee` / `clearingCurrencyId` | double / long |
| `exchangeFee` / `exchangeCurrencyId` | double / long |
| `nfaFee` / `nfaCurrencyId` | double / long |
| `brokerageFee` / `brokerageCurrencyId` | double / long |
| `ipFee` / `ipCurrencyId` | double / long |
| `commission` / `commissionCurrencyId` | double / long |
| `orderRoutingFee` / `orderRoutingCurrencyId` | double / long |

Every fee/currency pair is modeled as **independently nullable** in
`RawTradovateFillFee`: `null` = not reported, never an invented zero
(proven synthetically — "FillFee preserves each fee/commission category
independently, null distinct from zero", `smoke:tradovate`).

### 9a. UNRESOLVED — the FillFee-to-Fill linkage

**The official FillFee entity documented here carries no `fillId` field.**
This is stated plainly rather than assumed away. `RawTradovateFillFee`
therefore has `attributedFillId: string | null`, explicitly named to signal
it is an **adapter-side attribution**, not a native field:

- The generic REST "dependents" convention confirmed across this API
  (`<entity>/deps?masterid=<id>`, per `llms.txt` and the `fill-dependents.md`
  / `fill-fee-dependents.md` pages existing) suggests
  `fillFee/deps?masterid=<fillId>` is Tradovate's intended lookup — but this
  is **UNPROVEN UNTIL REAL ACCOUNT ACCESS**: no page fetched in this audit
  showed a worked example of that specific call succeeding.
  `finalReported.fillId` might also possibly be recoverable through
  `fill/deps?masterid=<orderId>` chained differently — genuinely unclear
  from documentation alone.
- Until this is confirmed, **no cost/P&L figure is computed or attributed to
  a Fill, Execution, or lifecycle candidate by this normalizer** (see
  `normalizer/types.ts` header). Commission/fee mapping into Solid Skill's
  canonical `commission`/`fees` schema columns (`DATABASE_SCHEMA.md` §3)
  remains entirely future work, gated on: confirming the Fill↔FillFee
  linkage, confirming currencies match the account's reporting currency
  (multi-currency fee rows would need conversion Solid Skill must never
  invent), and confirming this against real Apex data specifically (a
  prop-firm account's fee categories may differ from a personal brokerage
  account's).

## 10. Timestamps

Tradovate's documented convention is ISO-8601 UTC (`datetime` type on every
entity above). This raw contract preserves `timestamp` **exactly as
reported** — no timezone conversion, no session-date derivation. Official
Fill/Position entities also separately report `tradeDate` as a structured
`{year, month, day}`, reassembled here as `"YYYY-MM-DD"` and preserved
verbatim, never used to derive a session-boundary policy in this checkpoint.

**Still UNPROVEN UNTIL REAL ACCOUNT ACCESS:** whether `timestamp` is
genuinely always UTC in practice (the field type is documented as
`datetime` without an explicit timezone statement on the pages fetched), and
how `tradeDate` is computed by Tradovate (calendar UTC day vs. an
exchange-session boundary) — futures sessions do not align with UTC
midnight, and this checkpoint does not assume either interpretation.

## 11. Identifiers

- **Raw fill identity (deduplication key):** `["Tradovate", accountId,
  fillId]` (`rawFillIdentity()`). Not identity: timestamp, contract,
  arrival order, or array index.
- `orderId` is preserved on every fill as the official join key to Order
  (and thus to `accountId` — §5, §8), never used as fill identity.
- `contractId` / `contractName` are preserved verbatim — a dated contract
  (e.g. `MNQZ6`) is never collapsed into a continuous/generic symbol.
  (`contractName` itself is **adapter-attributed** from a separate Contract
  lookup by `contractId`, since Fill does not carry it natively either —
  same treatment as `accountId`.)
- Position/FillPair/FillFee each get their own identity helpers
  (`rawPositionIdentity`, `rawFillPairIdentity`, `rawFillFeeIdentity`) that
  explicitly tag which entity kind they belong to, so none of them can be
  confused with a Fill identity or a lifecycle identity by construction.

## 12. Read-only guarantee

The official endpoint index (`llms.txt`) confirms Tradovate's REST API does
expose write endpoints — `place-order`, `cancel-order`, `modify-order`,
`liquidate-position`, `liquidate-positions`, `place-oco`, `place-oso`, and
the order-strategy start/modify/interrupt family. **None of them appear
anywhere in this contract, in `transport.ts`, in `adapter.ts`, or in
`fakeTransport.ts`.** `TradovateTransport` has no method whose name or
endpoint resembles any of the above; `npm run smoke:tradovate` statically
scans every `.ts` file under `src/main/integrations/tradovate/` for such
patterns (including the now-confirmed exact official path fragments
`order/placeorder`, `order/cancelorder`, `order/modifyorder`,
`position/liquidateposition`) and fails the suite if any appear.

## 13. Auth / session — PROVEN BY OFFICIAL DOCS

- `POST /auth/accesstokenrequest`: `name`, `password`, `appId`,
  `appVersion`, `cid`, `sec` (+ optional `deviceId`, `hibpCheck`) →
  `accessToken`, `expirationTime`, `userId`, `name`, `hasLive`,
  `hasSimPlus`, `userStatus`, optional `errorText`/`hibpHint`.
- `GET /auth/renewaccesstoken` (Bearer auth): returns a fresh `accessToken`
  + `expirationTime` (plus the same optional account-status fields).
  **Official guidance, quoted:** monitor expiration and renew "if
  expiration is within 15 mins"; using renewal in a long-running app
  "will ensure that you don't start a new session unless it is 100%
  necessary. This will prevent your application from kicking itself or
  dropping dependent services that share an Access Token." This directly
  confirms the **2-concurrent-session limit is a real operational
  constraint**, not just a secondary detail — a real implementation must
  renew, not re-authenticate, as its default path.
- `TradovateSession.expiresAtMsc` and `TradovateTransport.renewSession`
  (`transport.ts`) exist as first-class capabilities specifically so a real
  implementation is structurally nudged toward this documented pattern.

## 14. Live sync — PROVEN BY OFFICIAL DOCS (message shape); frame format still open

Official `user/syncrequest` (WebSocket), confirmed 2026-09-22: request body
`{ splitResponses, users, accounts, shardingExpression?, entityTypes }`.
`splitResponses: true` is documented as required for B2B vendors.
`entityTypes` is documented as **defaulting to an empty array if omitted —
meaning no updates for most entity types are received** unless explicitly
listed; confirmed entity type names include `"user"`, `"account"`,
`"fill"`, `"fillPair"`, `"order"` (documentation states these are examples,
not an exhaustive list). The endpoint delivers an initial dataset followed
by ongoing updates gated by the same `entityTypes` list.

**UNPROVEN UNTIL REAL ACCOUNT ACCESS:** the exact frame/response JSON shape
per entity type was not specified on the page fetched. `TradovateTransport.subscribeToFills`
(`transport.ts`) therefore models the capability ("give me a callback for
new fills on this account") rather than a specific frame parser, so a real
implementation is free to parse whatever the live frame shape turns out to
be without changing the adapter or normalizer.

## 15. Remaining real-data unknowns (consolidated)

Everything in this section requires a real account (ideally the user's Apex
account) and is **not** assumed either way anywhere in the code:

1. Retention depth / practical sufficiency of `fill/list` for full history.
2. Whether the Apex-provisioned API key/account exposes all needed
   historical entities at the expected scope.
3. Real FillPair semantics (§7): partial exits, one-fill-in-many-pairs,
   provider-accounting vs. analytical-grouping.
4. The FillFee→Fill linkage mechanism (§9a).
5. Whether Position's daily `netPos` matches the normalizer's own
   from-fills reconstruction (a reconciliation opportunity, unconfirmed).
6. Real timestamp timezone behavior and `tradeDate` computation (§10).
7. Tradovate's real JSON field types (the docs describe `double`/`integer`/
   `long`; a real transport must convert these to canonical decimal
   strings at the boundary using exact string-based conversion, never
   `Number` arithmetic — untested against a real payload in this spike).
8. Real reversal-fill behavior (does Tradovate's own accounting treat a
   same-fill reversal as closing-then-reopening, or as one continuous
   position record?).

None of the above blocks this checkpoint's goal (a proven, replaceable,
read-only adapter boundary with synthetic coverage against an accurate,
officially-sourced schema); they block the *next* checkpoint that would
attempt a real connection or any persistence.
