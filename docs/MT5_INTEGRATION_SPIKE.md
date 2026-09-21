# MT5 Integration Spike — Read-Only Raw Deal Bridge

Checkpoint 012. An engineering spike: prove a safe, read-only,
restart-tolerant path from MetaTrader 5 to the Solid Skill Electron main
process using **raw MT5 facts**. It does **not** produce normalized Trades.
Wire format: `MT5_RAW_DEAL_CONTRACT.md`. EA setup: `integrations/mt5/README.md`.

## 1. Purpose

```
MT5
 ↓
Read-only EA Adapter  (integrations/mt5/ea/SolidSkillBridge.mq5)
 ↓
Raw Deal Contract     (MT5_RAW_DEAL_CONTRACT.md)
 ↓
MT5 Receiver          (src/main/integrations/mt5/)
 ↓
raw validation + dedup staging (in memory)
 ↓  ── not built yet ──
future MT5 Normalizer → Trading Domain → SQLite
```

Everything below the staging line is future work and does not exist.

## 2. Read-only invariant

**The Solid Skill MT5 integration is READ-ONLY.** Solid Skill observes the
account; it never controls it. The EA must never: send, modify or cancel an
order; open or close a position; modify SL, TP or volume; call `OrderSend` /
`OrderSendAsync`; use `CTrade` (or anything from `Trade.mqh`) to execute; or
expose any API/IPC operation capable of trading.

How it is enforced, not just promised:

- The EA has no `#include`, no `#import` (no DLLs), no trading calls.
- The socket is **send-only**: the EA never calls `SocketRead`, so there is no
  channel through which Solid Skill (or an impostor) could instruct it.
- The receiver never writes to the socket (asserted by test).
- No renderer IPC exists for MT5 at all; the preload API is unchanged.
- `npm run smoke:mt5` statically scans the `.mq5` for forbidden constructs
  (`OrderSend*`, `OrderCheck/Calc*`, `CTrade`, `Trade.mqh`, `TRADE_ACTION_*`,
  `Position*` mutators, `#include`, `#import`, `SocketRead`, `WebRequest`,
  file I/O, shell) and fails the smoke suite if any appear.

## 3. MT5 Order vs Deal vs Position

- **Order** — an instruction/request to the trade server. Not an execution.
- **Deal** — an execution fact: one fill at a price and volume. Has a deal
  ticket, the order ticket that caused it, and the position id it affected.
- **Position** — the resulting open exposure on a symbol. Identified by a
  position id/ticket that survives partial fills.

Order ≠ Deal ≠ Position. This spike transports **Deals** (the ground truth).
A completed Trade is never inferred from `DEAL_TYPE` alone: a deal's type is
the side of *that deal*, and the lifecycle decides direction —
`BUY IN … SELL OUT` is a LONG, `SELL IN … BUY OUT` is a SHORT; the closing
side never determines direction. Non-trade deals (balance, credit,
commission, …) also arrive as deals and are transported unfiltered.

## 4. Netting vs hedging

`ACCOUNT_MARGIN_MODE` is captured in `hello` as a raw integer:
RETAIL_NETTING (0), EXCHANGE (1), RETAIL_HEDGING (2).

- **Netting/Exchange:** one net position per symbol; a deal in the opposite
  direction can reduce, close, or **reverse** it (`DEAL_ENTRY_INOUT`).
- **Hedging:** several independent positions on the same symbol, including
  opposite directions, each with its own position id.

Consequently nothing here assumes "one symbol = one position". Every deal
carries `positionId`; the receiver stores it as-is and the fixtures cover
interleaved hedged positions and a netting reversal. Reconstruction design
(next step) must key on source position ids and honour the accounting mode.

## 5. Live event behavior

`OnTradeTransaction` reacts to `TRADE_TRANSACTION_DEAL_ADD` only:
take `trans.deal`, read the **authoritative** deal record with
`HistoryDealSelect(ticket)` + `HistoryDealGet*` (`SendLiveDeal`, the only place
in the EA that selects a deal; see §10a), send one raw `deal` frame
(`origin: "live"`). It builds nothing else. If MT5 cannot yet return the deal
(history not synchronized), the ticket goes to a small retry queue drained by
`OnTimer` (5 attempts, then an `error` frame with the ticket is sent so the
gap is visible and the next history sync fills it). If the socket is down,
the event is simply dropped: **live delivery is best-effort; history
reconciliation is the guarantee.**

## 6. Transaction-order limitation

MT5 does not guarantee that trade-transaction events arrive in the order the
things happened, nor that history is readable at the instant the event fires.
So: the EA sends what history says, the receiver never assumes arrival order
(each deal is keyed by ticket and carries `timeMsc`), and a later normalizer
must sort by `timeMsc`/ticket and never by arrival. Arrival sequence is
recorded only as a diagnostic. (Tested: CASE 7.)

## 7. Transport options considered

| | A. Raw TCP socket (`Socket*`) | B. `WebRequest` / local HTTP |
|---|---|---|
| MT5 allow-list | Address must be in *Tools → Options → Expert Advisors* allowed addresses | Same allow-list; URL-based |
| Custom port | Yes (any port passed to `SocketConnect`) | Documented as scheme-default only (80/443) → would force a privileged/odd local port or a proxy |
| Blocking | `SocketConnect` blocks up to the timeout (we use 1 s, from `OnTimer` only); `SocketSend` of a small frame is effectively immediate | Every request blocks until the HTTP response; each deal = a full round trip in the EA thread |
| Latency | Lowest; persistent connection | Higher; per-request overhead |
| Reconnect | We own it (backoff 1→30 s) | Stateless, so no connection to lose, but every call can fail independently |
| Framing | We define it (newline-delimited JSON) | HTTP provides it |
| Reliability | Loss on disconnect → healed by history replay | Same; request/response gives an ack we do not need |
| Complexity | Small on both sides (`net` server, ~20 lines of send code) | Needs an HTTP server, routes, request parsing, response codes |
| Local-only security | Bind `127.0.0.1`; trivial to reason about | Also possible, but a bigger, more "web-like" surface |
| Direction | One-way is natural | Request/response invites a return channel we deliberately do not want |

## 8. Selected transport

**A — raw TCP to `127.0.0.1`, newline-delimited JSON, one-way (EA → Solid
Skill).** Reasons: custom port support, persistent low-latency connection, the
smallest protocol and receiver, no return channel (supports the read-only
invariant), and dedup-by-replay makes fire-and-forget delivery safe.

Caveat stated plainly: the MQL5 `Socket*` behavior described here comes from
the MQL5 API as documented and has **not** been exercised against a real
terminal in this checkpoint (see §15).

## 9. Localhost security (threat boundary)

- The listener binds **only** `127.0.0.1` (or `::1`). The constructor throws
  for any other host; there is no configuration to expose it to LAN/Internet.
  Non-loopback peers are also refused at accept time.
- The EA itself refuses any `InpHost` other than a loopback name.
- No commands: the receiver treats input strictly as data. No shell, no
  filesystem access, no path from MT5 is ever used, nothing is `eval`ed, and
  the receiver never writes to the peer.
- No credentials cross the wire (no passwords, investor passwords, tokens).
- Bounded input: 16 KiB frames, ≤ 8 connections, ≤ 200 000 staged deals,
  10 s handshake and 60 s idle timeouts, strict per-field validation.
- Misbehaving peers lose their own connection only; the app never crashes.
- **Optional local pairing key** (`bridgeKey` in `hello`, env
  `SOLID_SKILL_MT5_BRIDGE_KEY` on the app, EA input `InpBridgeKey`): compared
  by SHA-256 + constant-time compare, never logged or exposed. It is a
  lightweight guard against unrelated local processes, not a broker
  credential. Off by default in the spike.
- Bridge is **opt-in**: `SOLID_SKILL_MT5_BRIDGE=1` (`SOLID_SKILL_MT5_PORT`,
  default 47615). Off, no socket is opened.

Residual risk, accepted for a spike: any process running as a local user can
connect to the loopback port; without a pairing key it could inject fake
raw deals into staging (they still cannot reach Trades — there is no path).
Another process could also squat the port before Solid Skill starts and
receive account facts from the EA. A pairing-key UX and per-install random
port/key exchange belong to the real Accounts work.

## 10. History reconciliation

On every (re)connect the EA performs
`HistorySelect(now − InpHistoryLookbackDays, now + 1 day)` → iterate
`HistoryDealGetTicket(i)` → send each deal wrapped in
`history_begin` / `history_end` (carrying `discovered` / `sent` / `failed`
counts, see §10a). It repeats a short
2-day sync every `InpReconcileMinutes` (default 15) to catch anything live
delivery missed. Restart recovery:

```
Solid Skill closed, trades happen
→ Solid Skill starts, EA reconnects (backoff ≤ 30 s)
→ hello + history replay
→ missing raw deals arrive; known ones are ignored
```

Limitation: only deals inside the lookback window are replayed
(`InpHistoryLookbackDays=0` means all available history). The loop runs in
`OnTimer` and blocks the EA thread while it iterates; acceptable for
thousands of deals, to be re-measured with real accounts.

## 10a. First real-terminal QA and the history-loop fix

**PROVEN on the user's real MT5 terminal (first handshake):**

- The EA compiles in actual MetaEditor: 0 errors, 0 warnings.
- The EA attaches to the actual MT5 terminal.
- It works with algorithmic trading disabled.
- The TCP handshake to `127.0.0.1:47615` succeeds.
- `hello` reaches Solid Skill.
- The real account reports `ACCOUNT_MARGIN_MODE = RETAIL_HEDGING`. This is QA
  evidence about one account only; nothing in the app assumes or hardcodes it.
- History reconciliation begins (`history_begin` received).

**OBSERVED ISSUE:** the first real reconciliation produced many
`DEAL_FETCH_FAILED` errors, and the receiver still logged
`history sync complete: received 1/1`.

**Root cause (confirmed by reading the code):** `SendDeal()` began with
`HistoryDealSelect(ticket)` and `SyncHistory()` called it from inside the
`HistorySelect` → `HistoryDealGetTicket(i)` loop. Per the MQL5 documentation,
`HistoryDealSelect` replaces the selected deal list with that single deal.
Index 0 therefore worked; after it, the list had collapsed and every later
`HistoryDealGetTicket(i)` failed. Path: `SyncHistory` → `SendDeal` →
`HistoryDealSelect`. This matches the observation (first deal succeeds, then
a run of failures). Re-verified on the real terminal after the fix (see the
post-fix results below).

**Second defect (misleading count):** the EA declared `dealCount` = number of
deals it managed to send, so `received == declared` (1 == 1) and the receiver
reported `complete` even though dozens of deals failed. The wire contract had
no way to say "MT5 listed 40, I sent 1".

**Fix:**

- History loop: `HistorySelect` → capture `HistoryDealsTotal()` once → for each
  original index `HistoryDealGetTicket(i)` → read properties directly by ticket
  (`ReadInt`/`ReadDouble` → `SendDealProperties`). `HistoryDealSelect` is not
  called anywhere reachable from the loop.
- Live path is separate and explicit: `SendLiveDeal` selects the ticket, then
  calls the same property reader. It is never used inside the history loop.
- `history_end` now carries `discovered` (`HistoryDealsTotal`), `sent`, and
  `failed`. The receiver reports `complete` only when `failed == 0`,
  `sent == discovered`, and it received exactly `sent` frames; otherwise
  `incomplete`. The EA's own log says `INCOMPLETE` in the same cases.
- Diagnostics: `error` frames and the Experts log carry `stage` (failing call
  or property), history `index`, deal `ticket`, and `GetLastError()`;
  `ResetLastError()` runs before each diagnosed call. At most 10 detailed
  failures are reported per sync; the rest are only counted in `history_end`.
  No credentials or prices are included.
- Regression tests (`npm run smoke:mt5`): a static scan that fails if
  `HistoryDealSelect` appears anywhere in the history path, appears more than
  once in the EA, or if `history_end` stops carrying all three counts; plus
  receiver tests proving a "1 of 40" sync is `incomplete`. MQL5 itself is not
  executed by the suite.

### Post-fix real-terminal retest (Checkpoint 012 final QA) — PASSED

The EA was recompiled and retested against the user's real MT5 terminal.

- MetaEditor: `SolidSkillBridge.mq5` compiled with 0 errors, 0 warnings.
- Terminal: EA attached, algorithmic trading remained disabled, connected
  read-only to `127.0.0.1:47615`; the real account was detected as
  `RETAIL_HEDGING`.

**First post-fix history sync**

- MT5: `History sync complete: discovered 55, sent 55, failed 0`
- Solid Skill: `MT5 history sync COMPLETE: discovered 55, EA sent 55, EA failed 0,
  received 55; 55 new, 0 already known`

**Second reconnect / reconciliation**

- MT5: `History sync complete: discovered 55, sent 55, failed 0`
- Solid Skill: `MT5 history sync COMPLETE: discovered 55, EA sent 55, EA failed 0,
  received 55; 0 new, 55 already known`

**Proven on the real terminal:**

- The `HistoryDealSelect` bug is fixed.
- All 55 discovered deals were serialized, and all 55 reached Solid Skill;
  no fetch failures occurred.
- Reconnect works.
- History replay is idempotent, and deduplication works on real MT5 data.
- `RETAIL_HEDGING` detection works.
- Read-only operation works with algorithmic trading disabled.

The receiver's `COMPLETE` status is now backed by real evidence
(`failed == 0`, `sent == discovered`, `received == sent`). This does not
extend to the items in §15.

## 11. Deduplication strategy

Identity = `["MT5", server, accountLogin, dealTicket]`. Not timestamp,
symbol, position id, or index. Same identity + same facts → `duplicate`
(ignored). Same identity + different facts → `conflict` (first-seen kept,
counted, never overwritten — historical facts must not silently change).
Replaying is therefore always harmless, which is what lets the transport be
fire-and-forget.

## 12. Reconnect behavior

EA: exponential backoff from 1 s to 30 s, a fresh socket per attempt, logging
of the first failure and then every 20th (Solid Skill not running is normal).
Account switches inside the terminal force a reconnect with a new `hello`.
Receiver: a dropped connection only marks the account disconnected and
aborts any in-flight sync (`aborted`); state is otherwise untouched. MT5
offline, Solid Skill offline, and port-in-use at startup are all non-fatal.

## 13. Raw staging decision

**In-memory only** (`RawDealStaging`). No migration, no schema change, no new
table, `TradeRepository` untouched. Rationale: the schema for raw MT5 events
rests on unverified assumptions (real position-id behavior on reversal,
history depth, external ids); persisting them now would freeze guesses into
the production schema. Data lost on restart is recovered by history replay,
so nothing is lost for the spike. If a normalizer needs durable raw deals,
that requires migration 002 and **should be a deliberate, reviewed step**
(see §16). No migration was created in this checkpoint.

## 14. What is proven

Against a fake EA emulating the wire protocol, in the real Electron Node
runtime (`npm run smoke:mt5`, no MetaTrader needed): loopback-only listener
lifecycle; hello validation and accounting-mode capture; raw preservation of
LONG, SHORT, four-deal scale-in/out, hedged independent positions, and a
netting reversal (`INOUT`) with no derived direction or segmentation;
duplicate/replay/out-of-order/restart-gap handling; distinct commission, fee,
swap with null ≠ zero; malformed, oversized, unterminated, and binary input
rejected without crashing; disconnect/reconnect and `stop()` with live
clients; decimal validation agreeing with the persistence fixed-point codec;
and, statically, that the EA source contains no trading API.

## 15. What is NOT proven

Historical sync itself is now proven on a real terminal (§10a, 55/55 deals,
idempotent replay). Still unproven:

- **Real live `OnTradeTransaction` delivery** has not been observed on a real
  terminal.
- **Real netting reversal `DEAL_POSITION_ID` behavior** is not proven (the
  test account is `RETAIL_HEDGING`); exact `DEAL_ENTRY` values for real
  brokers are also unconfirmed (fixtures are synthetic).
- Sockets in every terminal setup (e.g. not in the Strategy Tester, and a
  terminal on a remote VPS cannot reach this PC's loopback).
- Real-world history sizes beyond 55 deals, sync duration, and
  `HistoryDealGetTicket` cost.
- Raw deals are staged **in memory only**; nothing is persisted.
- **No MT5 normalizer exists yet**, and no raw MT5 data is written to
  normalized Trade persistence.
- Anything about Tradovate.
- No trading capability exists: the integration is read-only and the EA
  contains no trading API (statically checked by `npm run smoke:mt5`).

## 16. Next normalization step

Not started. Before building a MT5 Normalizer: (1) run the EA against a demo
account, capture real deals for the cases in §14, anonymize them into
fixtures; (2) confirm reversal/position-id behavior; (3) decide durable raw
storage (migration 002) deliberately; (4) design lifecycle reconstruction
keyed on source position ids and account accounting mode, sorted by
`timeMsc`, producing normalized executions per `TRADE_MODEL_CONCEPTS.md`;
(5) only then feed `TradeRepository`. Historical-integrity rules (CLAUDE.md
rule 3) apply to whatever is stored from that point on.
