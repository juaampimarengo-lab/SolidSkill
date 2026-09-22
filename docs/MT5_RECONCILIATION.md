# MT5 Automatic Reconciliation (Checkpoint 012B-4)

Turns the already-proven MT5 pipeline (`MT5_RAW_DEAL_CONTRACT.md` →
`MT5_NORMALIZATION.md` → `MT5_IMPORT.md`) into a **safe, automatic**
reconciliation pipeline, while remaining strictly **read-only** toward MT5.
Code: `src/main/integrations/mt5/reconciliation/`.

> **READ-ONLY.** This checkpoint adds no capability to send anything to MT5.
> It decides *when* to call the existing, already-proven importer; it never
> builds a second importer and never places, modifies, cancels, or closes
> anything.

## 1. Purpose

Before this checkpoint, the only way new MT5 facts reached SQLite was an
explicit developer action (`npm run dev:mt5-live-import`, gated by
`SOLID_SKILL_MT5_DEV_IMPORT=1`). This checkpoint adds an **opt-in, development
build only** automatic path:

```
MT5 -> raw staging -> normalizer -> automatic idempotent reconciliation -> SQLite
```

The manual gate is unchanged and remains available as QA/fallback (§9).

## 2. No second importer

Every automatic reconciliation run is one call to the existing
`importFromLiveStaging` (`src/main/integrations/mt5/import/liveImport.ts`),
the same function the manual dev gate calls. It uses the same pure
normalizer and the same `Mt5ImportService`, so every rule already documented
in `MT5_IMPORT.md` — idempotency, conflict-never-overwrites, dev-database-only
target, currency-from-hello, open/unresolved/unsupported handling — applies
unchanged. This checkpoint only decides **when** to call it
(`src/main/integrations/mt5/reconciliation/reconciliationCoordinator.ts`);
it introduces no new persistence mapping and no new Trade-construction logic.

## 3. History state machine

A history sync is `hello → history_begin → deal(s) → history_end`. The
receiver (`receiver.ts`, unchanged by this checkpoint) already classifies a
sync as `complete` only if `failed == 0`, `sent == discovered`, and it
received exactly `sent` deal frames; anything else is `incomplete`, and a
connection lost mid-sync is `aborted`.

The reconciliation coordinator reacts only to the **complete** case:

- `history_end` with `status: 'complete'` → the account is marked **READY**
  and one reconciliation run is scheduled for it.
- `history_end` with `status: 'incomplete'` (or a sync that never reaches
  `history_end`, i.e. `aborted`) → **nothing is scheduled**. No partial
  history is ever imported; a diagnostic line is logged.

A reconnect always drives a brand-new full history sync (the EA's existing
behavior); a fresh `complete` history_end reconciles again, and because the
underlying importer is idempotent by source lifecycle identity, this is safe
to run any number of times.

## 4. Live state machine

Once an account is READY, each `deal_accepted` event with `origin: 'live'`
schedules a debounced reconciliation for that account (§5). History-origin
deals never trigger through this path — they are handled exclusively by the
history state machine above, so a sync in progress cannot trigger a run
before it completes.

Because reconciliation always re-normalizes **all** currently staged deals
for the account (not just the one new deal), lifecycle semantics stay
identical to history import:

- a live opening deal (`DEAL_ENTRY_IN`) alone produces an `open` normalizer
  candidate → the importer's existing rule skips it (`skippedOpen`) → **no
  Trade is persisted**;
- the later closing deal completes the same `sourceLifecycleKey` → the next
  reconciliation pass normalizes both deals together → the importer creates
  **exactly one** Trade with all of its Executions.

No Trade is ever constructed directly from a live deal or from
`OnTradeTransaction`; the path is always
`raw fact → staging → normalizer → importer → persistence`, identical for
history and live facts.

## 5. Trigger rules, debounce and coalescing

`AccountReconciler` (`accountReconciler.ts`) is a small, MT5-agnostic
primitive per source account:

- `trigger()` schedules a run after a short debounce window (default
  **300 ms**, chosen to coalesce a burst of near-simultaneous deal callbacks
  — e.g. several fills reported in quick succession — into one reconciliation
  pass, while staying short enough that the Journal/Calendar refresh promptly
  after a real fill);
- a `trigger()` while a run is already scheduled but not yet started is a
  no-op (already coalesced);
- a `trigger()` that arrives **while a run is executing** schedules exactly
  **one** follow-up run after the current one finishes — never a queue, never
  more than one pending follow-up;
- `cancel()` drops a pending (not yet started) run; a run already executing
  is left to finish.

MT5 live events are not assumed to arrive in analytical order (per
`MT5_RAW_DEAL_CONTRACT.md` / `MT5_NORMALIZATION.md`); this is a non-issue
here because canonical ordering is entirely the normalizer's job (§3 of
`MT5_NORMALIZATION.md`) — the coordinator only decides *when* to re-run it,
never how to order deals.

## 6. Serialization (one reconciliation per account)

Each source account (`accountKey(server, login)`) gets its own
`AccountReconciler` inside `Mt5ReconciliationCoordinator`
(`reconciliationCoordinator.ts`). Different accounts are fully independent —
neither their reconcilers nor their trigger state interact. No job framework
is used: the whole mechanism is one `Map<accountKey, AccountReconciler>` plus
the debounce/coalescing primitive above.

## 7. Disconnect / reconnect

On `disconnected` for an account: the coordinator cancels any pending
scheduled reconciliation for that account and clears its READY flag.
Persisted Trades are never touched — disconnection is purely a "stop
scheduling" signal. On reconnect, the EA always resyncs full history; a fresh
`complete` history_end marks the account READY again and reconciles. Because
every reconciliation is idempotent by source lifecycle identity, no duplicate
Account, Trade, or Execution can result from any disconnect/reconnect
sequence.

## 8. Multi-account isolation

State is keyed by the source account identity (`accountKey(server, login)`
from `receiver.ts`), never by a single global "current MT5 account" variable.
Raw deals never mix between accounts: the receiver's shared staging already
tags every deal with its own `server`/`accountLogin`, and
`importFromLiveStaging` filters staged deals to the one account being
reconciled before normalizing. Reconciling account A never reads or writes
account B's Trades.

## 9. Environment opt-in (this checkpoint's automation gate)

Automatic reconciliation is wired only when **both** are true:

- the build is unpackaged (`!app.isPackaged`);
- `SOLID_SKILL_MT5_AUTO_IMPORT=1`.

```
SOLID_SKILL_MT5_BRIDGE=1 SOLID_SKILL_MT5_AUTO_IMPORT=1 npm run dev
```

`createMt5ReconciliationCoordinatorFromEnvironment` returns `null` otherwise
(`src/main/index.ts` never calls the coordinator in that case). With the
bridge enabled but `SOLID_SKILL_MT5_AUTO_IMPORT` absent or not `1`, the
bridge and history observation work exactly as before — **nothing is ever
imported automatically**.

This is a **separate, coexisting** gate from the manual one
(`SOLID_SKILL_MT5_DEV_IMPORT=1`, `MT5_IMPORT.md` §14): both may be enabled at
once, and the manual `npm run dev:mt5-live-import` command remains available
and unaffected as a QA/fallback path — it is not required when automatic
reconciliation is enabled, but nothing about this checkpoint removes it.

Automatic reconciliation is **not** enabled by default for a packaged
production build, and this checkpoint does not add any settings/Integrations
UI to turn it on later — that is future work (`MT5_IMPORT.md` §18).

## 10. Importer reuse and dev-database-only target

`importFromLiveStaging` already refuses any target database that is not the
`solid-skill-dev` profile, a temp path, or `:memory:` (`isDevelopmentDatabasePath`,
unchanged). The reconciliation coordinator calls this exact function and
therefore inherits the same refusal automatically — there is no separate
"is this a dev database" check in the coordinator itself.

## 11. Conflict policy

Unchanged from `MT5_IMPORT.md` §6: a differing replay under the same source
lifecycle identity is reported as a `conflict` and the persisted Trade is
**never overwritten**. Automatic mode does not relax or change this in any
way; the coordinator only forwards the importer's result and logs a masked
summary line per conflict.

## 12. Renderer refresh boundary

After a reconciliation run creates at least one new Trade, the coordinator
calls `onDataChanged({ accountId, reason: 'mt5-reconciliation' })`
(`src/main/index.ts` wires this to `notifyTradingDataChanged`,
`src/main/ipc/tradingEvents.ts`), which pushes a
`trades:dataChanged` IPC message to every open renderer window carrying
exactly:

```ts
{ accountId: string; reason: 'mt5-reconciliation' }
```

No MT5 login, server, deal ticket, or other raw source identity ever crosses
this boundary — the type itself only has room for the Solid Skill account
UUID and the fixed reason string. A run that creates nothing (a replay, a
refused/incomplete sync, an unsupported-only batch) never notifies.

The renderer subscribes once, in `useTrading`
(`src/renderer/src/hooks/useTrading.ts`), via
`window.solidSkill.trades.onDataChanged(...)`, and performs a **silent
re-read** of the trade list on any such event (the same `trades.list` call
already used on mount, through the existing latest-wins request-sequencing).
This is push-based, not polling: SQLite is never polled. Journal, Calendar
and Dashboard all derive from that one list, so they can show a newly
persisted MT5 Trade without the user switching accounts or navigating away
(`ACTIVE_ACCOUNT.md`). No screen was redesigned; only a `useEffect`
subscription was added to the existing hook.

## 13. Privacy

- Internal routing needs real source identity (server + login) to filter
  staged deals correctly per account. This flows through a **separate,
  internal-only** event channel (`Mt5Receiver`'s `onInternalEvent` /
  `Mt5InternalEvent`, distinct from the masked, loggable `onEvent` /
  `Mt5BridgeEvent` stream) so the existing masked-log invariant
  (`npm run smoke:mt5` — "diagnostic events mask account logins and carry no
  prices") is never at risk of regressing by construction.
- Every line the coordinator logs comes from `importFromLiveStaging`'s
  already-masked `summary.lines` / refusal messages, or is itself free of raw
  identity.
- The renderer notification (§12) carries only the Solid Skill account UUID.

## 14. Unsupported lifecycle behavior

Unchanged from `MT5_NORMALIZATION.md` / `MT5_IMPORT.md`: `OPEN`, `UNRESOLVED`
(including `INOUT_NOT_PRODUCTION_PROVEN` and `OUT_BY_UNSUPPORTED`), and
non-trading deals are still reported and never persisted. Automatic mode does
not relax any of these policies — it is a scheduling layer only, sitting
entirely on top of the unchanged importer.

## 15. Current analytical-date limitation

Unchanged (`MT5_IMPORT.md` §10, V1): the analytical trading date is still the
UTC calendar date of the lifecycle's opening deal, read from `DEAL_TIME_MSC`
as reported (broker server time). This checkpoint does not add a broker
timezone/session-boundary setting.

## 16. What remains before production-integration enablement

- A settings/Integrations UI to let a user opt in per account, replacing the
  environment-variable gate.
- Real capture of scale-in/out, partial exits, `OUT_BY`, and INOUT/netting
  reversal in a **live** (not just history-replay) reconciliation, to move
  those constructs from "synthetically covered" to "production proven".
- A broker trading-timezone / session-boundary setting for the analytical
  date (unchanged limitation, tracked in `MT5_IMPORT.md` §18).
- Explicit reconciliation-conflict resolution tooling (still future work;
  conflicts are reported, never resolved automatically).
- Tradovate's equivalent pipeline (out of scope here; this checkpoint is MT5
  only).
- Real DEMO/live account soak testing of the debounce/coalescing behavior
  under genuine trading activity (this checkpoint's live-path tests use
  synthetic fixtures only, per the "no real funded-account trade for testing"
  rule).

## 17. Manual importer coexistence

`npm run dev:mt5-live-import` (`MT5_IMPORT.md` §14, §17) is unchanged and
remains available as a QA/fallback path alongside automatic reconciliation.
Running it against an account that automatic reconciliation already
persisted is safe and idempotent — both paths call the same
`importFromLiveStaging`, so a manual run afterward reports `already
existing`, exactly as it would replaying itself.

## 18. Real historical replay QA (2026-09-21)

A manual QA pass replayed a **real** MT5 account's full history through the
automatic reconciliation path described above (`solid-skill-dev` schema v2,
`RETAIL_HEDGING`, currency `USD` reported by `hello`), with
`SOLID_SKILL_MT5_BRIDGE=1 SOLID_SKILL_MT5_AUTO_IMPORT=1` set per §9. The
account had 27 Trades / 54 Executions already persisted from an earlier
manual import (`MT5_IMPORT.md` §14/§17).

Observed result of the history sync → automatic reconciliation run:

| | before | after |
|---|---|---|
| Trades | 27 | 27 |
| Executions | 54 | 54 |

- 55 raw deals staged, 27 completed lifecycle candidates
- created Trades: 0 · already-existing Trades: 27
- created Executions: 0
- skipped open: 0 · skipped unresolved: 0 · skipped unsupported: 0
- ignored non-trading: 1
- conflicts: 0 · failures: 0
- LONG 18 / SHORT 9 · gross 283.38 · commission -68.15 · fees 0 · swap 2.43 ·
  net 217.66
- strategy assigned 0 · rule evaluations 0 · trade notes 0 (no Strategy
  Builder data was attached to this account for this QA pass)

This confirms, against a real broker history rather than synthetic fixtures,
that a complete history sync drives the automatic reconciliation path end to
end and **converges idempotently**: replaying an already-imported history
produces zero new Trades/Executions and zero conflicts, matching the
already-proven manual importer's idempotency (`MT5_IMPORT.md` §6) through the
new automatic scheduling layer.

### Duplicate EA instance observation

During this QA pass, `SolidSkillBridge` was attached to more than one chart
for the same MT5 account at once, which produced two independent
`hello` / history-sync cycles from the same underlying MT5 terminal. The
receiver's staging/dedup and the importer's idempotency-by-source-lifecycle
handled this safely — no duplicate Trades or Executions resulted — but this
is not a configuration to rely on.

**Operational recommendation:** attach `SolidSkillBridge` to exactly **one**
chart per MT5 account. Multiple simultaneous instances on the same account
are unnecessary, redundant, and were only incidentally proven safe here; they
are not a supported or intended setup.

### Limitations still open after this QA pass

- Live `OnTradeTransaction` open→close has not yet been proven with a
  real/demo **live** trade (only real **history replay** was exercised here).
- Real scale-in/out is still unproven against real broker data.
- Real partial exits are still unproven against real broker data.
- Real `INOUT`/`OUT_BY` lifecycles are still unproven against real broker
  data.
- Broker server timezone remains unknown (§15, unchanged).
- Packaged production automatic reconciliation remains disabled by default
  (§9, unchanged) — this QA pass used an unpackaged dev build with the
  explicit environment opt-in, exactly as designed.

## Testing

`npm run smoke:mt5-reconciliation`
(`src/main/integrations/mt5/reconciliation/__smoke__/reconciliationSmoke.ts`):
synthetic fixtures, in-memory SQLite, no MetaTrader. Covers the
`AccountReconciler` primitive in isolation (coalescing, reentrant
follow-up, cancellation, error containment) and the coordinator end to end
(incomplete vs. complete history, live open→closed lifecycle, LONG/SHORT,
burst coalescing, out-of-order convergence, disconnect/reconnect, multi
-account isolation, conflict-never-overwrites, unsupported/non-trading
no-ops, dev-database-only and invalid-currency refusals, the renderer
notification's shape/privacy, and manual-importer coexistence), plus a static
scan for trading capability / methodology terms. Existing suites
(`smoke:mt5`, `smoke:mt5-normalizer`, `smoke:mt5-import`,
`smoke:persistence`) and `qa:active-account` all stay green unchanged.
