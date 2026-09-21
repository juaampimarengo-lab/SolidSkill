# MT5 Raw Deal Contract (protocol v1)

Checkpoint 012 (spike). The wire contract between the **Solid Skill MT5
Read-Only Bridge** (an MQL5 Expert Advisor) and the Solid Skill Electron main
process. Reference implementation of the receiving side:
`src/main/integrations/mt5/protocol.ts`. Context and decisions:
`MT5_INTEGRATION_SPIKE.md`.

> **READ-ONLY.** This contract transports account and execution facts from
> MT5 to Solid Skill. It defines no message that can place, modify, cancel,
> or close anything, and no message flows from Solid Skill to the EA. The
> receiver never writes to the socket. Solid Skill observes the account; it
> never controls it.

## 1. Protocol / version

Every message carries `"v": 1`. A receiver rejects any other value. A future
incompatible change bumps `v`; additive fields inside v1 are ignored by
receivers that do not know them (only known fields are read).

The contract carries **raw MT5 facts**. It contains no derived direction, no
position or trade grouping, and no methodology concept.

## 2. Message framing

TCP to `127.0.0.1` (default port `47615`), **newline-delimited JSON**:

- One JSON object per frame, UTF-8, terminated by `\n` (a preceding `\r` is
  tolerated and stripped). Empty lines are ignored.
- Maximum frame size: **16 KiB** (receiver default; a deal frame is under
  1 KiB). An oversized frame, or 16 KiB without a newline, closes the
  connection immediately because framing can no longer be trusted.
- Direction is **EA → Solid Skill only**.

## 3. `hello`

Sent first on every connection. Nothing else is accepted before it; a peer
that sends anything else first is disconnected.

```json
{
  "v": 1, "type": "hello", "source": "MT5", "eaVersion": "1.0.0-spike",
  "account": {
    "login": "1000001", "server": "Demo-Server", "company": "Demo Broker Ltd",
    "currency": "USD", "marginMode": 2, "tradeMode": 0, "hedgeCapable": true
  },
  "terminal": { "build": 5000, "name": "MetaTrader 5" },
  "bridgeKey": "optional-local-pairing-key"
}
```

| Field | Notes |
|---|---|
| `account.login` | `ACCOUNT_LOGIN`, unsigned-integer **string**. A *source identifier*, never a Solid Skill primary key. |
| `account.server` | `ACCOUNT_SERVER`. Part of the account identity (a login is only unique per server). |
| `account.company` | `ACCOUNT_COMPANY`, nullable. |
| `account.currency` | `ACCOUNT_CURRENCY`. |
| `account.marginMode` | Raw `ENUM_ACCOUNT_MARGIN_MODE`: `0` RETAIL_NETTING, `1` EXCHANGE, `2` RETAIL_HEDGING. Unknown values are preserved; the receiver's label is null. |
| `account.tradeMode` | Raw `ENUM_ACCOUNT_TRADE_MODE` (demo/contest/real), nullable. |
| `account.hedgeCapable` | **Derived by the EA** from `marginMode == RETAIL_HEDGING`; nullable. |
| `terminal.build` / `terminal.name` | `TERMINAL_BUILD` / `TERMINAL_NAME`, nullable. |
| `bridgeKey` | Optional local **pairing key** for the loopback handshake (see spike doc §9). It is **not** a broker credential, is compared then discarded, and never appears in status or logs. |

**Never sent:** passwords, investor passwords, broker auth tokens, any
credential.

A second `hello` on a connection is rejected.

## 4. `deal`

One raw MT5 deal, read by the EA from MT5 history (`HistoryDealGet*`).

```json
{
  "v": 1, "type": "deal", "source": "MT5",
  "origin": "live", "syncId": null,
  "server": "Demo-Server", "accountLogin": "1000001",
  "dealTicket": "9002", "orderTicket": "8002", "positionId": "7001",
  "externalId": null, "timeMsc": 1760000060000, "symbol": "EURUSD",
  "dealType": 1, "dealEntry": 1,
  "volume": "1.00000000", "price": "1.08650000",
  "profit": "150.00000000", "commission": "-3.50000000",
  "fee": "0.00000000", "swap": null,
  "magic": "0", "reason": 0
}
```

| Field | MT5 property | Notes |
|---|---|---|
| `origin` | — | `"live"` (from `TRADE_TRANSACTION_DEAL_ADD`) or `"history"` (from a reconciliation sync). |
| `syncId` | — | Required for `history`, must be `null` for `live`. |
| `server`, `accountLogin` | account | Must equal the connection's `hello`, else rejected. |
| `dealTicket` | `DEAL_TICKET` | Non-zero unsigned string. Part of identity. |
| `orderTicket` | `DEAL_ORDER` | Unsigned string; `"0"` for e.g. balance deals. |
| `positionId` | `DEAL_POSITION_ID` | The **source position** id/ticket. `"0"` for non-trade deals. |
| `externalId` | `DEAL_EXTERNAL_ID` | Nullable (empty → null). |
| `timeMsc` | `DEAL_TIME_MSC` | Integer ms since epoch (a JSON number is safe: < 2^53). |
| `symbol` | `DEAL_SYMBOL` | Nullable (balance deals have none). |
| `dealType` | `DEAL_TYPE` | Raw integer. Diagnostic labels only (BUY, SELL, BALANCE, …). |
| `dealEntry` | `DEAL_ENTRY` | Raw integer: `0` IN, `1` OUT, `2` INOUT (reversal), `3` OUT_BY. |
| `volume`, `price` | `DEAL_VOLUME`, `DEAL_PRICE` | Decimal strings. |
| `profit`, `commission`, `fee`, `swap` | `DEAL_PROFIT/COMMISSION/FEE/SWAP` | Decimal string **or null**. Kept as four separate fields. |
| `magic` | `DEAL_MAGIC` | Unsigned string (opaque). |
| `reason` | `DEAL_REASON` | Raw integer. |

The deal `comment` is deliberately **not** transmitted (free text may contain
personal information).

**No direction field exists.** `dealType` is the side *of this deal*. The
analytical direction of a Trade is determined later, from the lifecycle:
`BUY IN … SELL OUT` is a LONG; `SELL IN … BUY OUT` is a SHORT. A closing SELL
does not make a Trade SHORT and a closing BUY does not make it LONG. Do not
infer a completed Trade from `dealType` alone; `INOUT`, partial exits and
non-trade deal types (balance, credit, commission, …) all exist.

## 5. Reconciliation and status messages

| Message | Shape | Purpose |
|---|---|---|
| `history_begin` | `{"v":1,"type":"history_begin","syncId":"<id>"}` | Opens a sync. `syncId`: `[A-Za-z0-9_-]{1,64}`. |
| `history_end` | `{"v":1,"type":"history_end","syncId":"<id>","discovered":D,"sent":S,"failed":F}` | Closes it. `discovered` = `HistoryDealsTotal()` after `HistorySelect`; `sent` = deals the EA read and sent; `failed` = deals it could not read. `sent`/`failed` must not exceed `discovered` (else the frame is rejected). Receiver marks the sync `complete` only if `F == 0`, `S == D`, and it received exactly `S` deal frames; anything else is `incomplete`. A connection lost mid-sync is `aborted`. The legacy `dealCount` field is no longer accepted. |
| `heartbeat` | `{"v":1,"type":"heartbeat"}` | Sent every 15 s. A peer silent for 60 s is dropped. |
| `error` | `{"v":1,"type":"error","code":"DEAL_FETCH_FAILED","dealTicket":"9001","detail":"…"}` | EA could not read a deal from history. `code` ∈ `DEAL_FETCH_FAILED`, `HISTORY_SELECT_FAILED`, `INTERNAL`. A `DEAL_FETCH_FAILED` ticket is tracked as **unresolved** until that deal arrives. Optional diagnostic fields: `stage` (failing MQL5 call/property, e.g. `HistoryDealGetTicket`, `DEAL_ORDER`), `index` (position in the `HistorySelect` list), `lastError` (`GetLastError()`). The EA sends at most 10 detailed history errors per sync; the exact totals are in `history_end`. |

Deals inside a sync carry `origin: "history"` and the sync's `syncId`. A
history deal outside an active matching sync is rejected. Replaying deals is
always safe (§7).

## 6. Decimal representation

Financial values are **decimal strings, never JSON numbers** (a JSON number
is a binary double; Solid Skill's persisted representation is exact fixed
point, scale 8 in a signed 64-bit integer — `src/main/persistence/fixedPoint.ts`).

Accepted grammar: `[+-]?digits[.digits]`. Rejected at the boundary:
JSON numbers, exponents (`1e5`), `NaN`, empty strings, thousands separators,
whitespace, more than 8 fractional digits after trimming trailing zeros
(**nothing is ever rounded**), values outside the signed 64-bit scaled
range, and negative `volume`/`price`.

The receiver canonicalizes (`"1.08500000"` → `"1.085"`, `"+2"` → `"2"`,
`"-0"` → `"0"`). A smoke test asserts the wire validator and the persistence
codec agree. The EA formats with `DoubleToString(value, 8)`.

## 7. Identifiers

- Tickets, position ids, order tickets, magic, and login are **unsigned
  64-bit integers transmitted as decimal strings** (`^(0|[1-9]\d{0,19})$`,
  ≤ 2^64−1), because MT5 tickets can exceed JavaScript's 2^53 safe range.
- **Raw deal identity** (deduplication key):
  `["MT5", server, accountLogin, dealTicket]`.
  Not identity: timestamp, symbol, position id, arrival order or index.
- A replay with the same identity and identical facts is a harmless
  `duplicate`. A replay with the same identity but **different** facts is a
  `conflict`: the first-seen record is kept, the conflict is counted, and
  nothing is overwritten (MT5 deals are immutable; a differing replay means a
  misbehaving sender).
- The source position id (`positionId`) is always preserved. Do not assume
  one position per symbol: RETAIL_HEDGING accounts hold several independent
  positions per symbol, including opposite directions.

## 8. Nullable fields

Every field is **required to be present**; nullable ones must be stated as
`null`. A missing key is an error, so "not reported" can never be confused
with "forgot to send".

`null` = MT5 did not report the value. `"0"` = MT5 reported zero. They are
distinct and both preserved. Nullable: `company`, `tradeMode`,
`hedgeCapable`, `terminal.*`, `externalId`, `symbol`, `profit`,
`commission`, `fee`, `swap`, error `detail`/`dealTicket`.

## 9. Validation

Receiver behavior (all covered by `npm run smoke:mt5`):

- Non-JSON, non-object, wrong `v`, unknown `type`, missing/mistyped/oversized
  fields, control characters in strings, `timeMsc` outside 2000–2100 → frame
  **rejected**, nothing staged.
- Before `hello`: any invalid or non-`hello` frame → connection **dropped**.
- After `hello`: invalid frames are counted and tolerated up to 10 per
  connection (so a single bad deal cannot wedge a history sync forever),
  then the connection is dropped.
- Deal `server`/`accountLogin` must match `hello`.
- Oversized frame → connection dropped. Silent peer → dropped after a 10 s
  handshake window / 60 s idle window.
- Errors never crash the receiver; a bad peer only loses its own connection.

## 10. Examples

History sync of a LONG lifecycle (each line is one frame):

```
{"v":1,"type":"hello","source":"MT5","eaVersion":"1.0.0-spike","account":{"login":"1000001","server":"Demo-Server","company":"Demo Broker Ltd","currency":"USD","marginMode":0,"tradeMode":0,"hedgeCapable":false},"terminal":{"build":5000,"name":"MetaTrader 5"}}
{"v":1,"type":"history_begin","syncId":"1760000100-1"}
{"v":1,"type":"deal","source":"MT5","origin":"history","syncId":"1760000100-1","server":"Demo-Server","accountLogin":"1000001","dealTicket":"9001","orderTicket":"8001","positionId":"7001","externalId":null,"timeMsc":1760000000000,"symbol":"EURUSD","dealType":0,"dealEntry":0,"volume":"1.00000000","price":"1.08500000","profit":"0.00000000","commission":"-3.50000000","fee":"0.00000000","swap":"0.00000000","magic":"11","reason":0}
{"v":1,"type":"deal","source":"MT5","origin":"history","syncId":"1760000100-1","server":"Demo-Server","accountLogin":"1000001","dealTicket":"9002","orderTicket":"8002","positionId":"7001","externalId":null,"timeMsc":1760000060000,"symbol":"EURUSD","dealType":1,"dealEntry":1,"volume":"1.00000000","price":"1.08650000","profit":"150.00000000","commission":"-3.50000000","fee":"0.00000000","swap":"0.00000000","magic":"11","reason":0}
{"v":1,"type":"history_end","syncId":"1760000100-1","discovered":2,"sent":2,"failed":0}
{"v":1,"type":"heartbeat"}
```

Netting reversal raw facts (LONG 1, then SELL 2 — one `INOUT` deal, not split):

```
… "positionId":"7401","dealType":0,"dealEntry":0,"volume":"1.00000000" …
… "positionId":"7401","dealType":1,"dealEntry":2,"volume":"2.00000000" …
```

Fixtures used by the tests are synthetic and anonymized:
`src/main/integrations/mt5/__smoke__/fixtures.ts`.
