# Tradovate Real Connectivity QA (Checkpoint 013B)

The first checkpoint to build a REAL (HTTP) Tradovate transport and attempt
real, read-only connectivity. Builds directly on the spike
(`TRADOVATE_INTEGRATION_SPIKE.md`) and the audited raw contract
(`TRADOVATE_RAW_CONTRACT.md`) — nothing here changes the adapter/normalizer
boundary, and **no real Tradovate Trade, Account, or Execution was persisted
to SQLite** (none can be: see "No SQLite write path" below).

## Result: BLOCKED — no real credentials available

This environment has none of `SOLID_SKILL_TRADOVATE_NAME`,
`_PASSWORD`, `_APP_ID`, `_APP_VERSION`, `_CID`, `_SEC` set. Per the
checkpoint's "Auth blocker behavior" instruction, **no connection was
attempted and nothing was guessed**. `npm run dev:tradovate-real-qa` detects
this deterministically (`loadTradovateCredentialsFromEnv`,
`src/main/integrations/tradovate/credentials.ts`) and prints the exact
blocker:

```
BLOCKED: real Tradovate connectivity was not attempted.
Real Tradovate connectivity is blocked: the following environment variables are not set:
  - SOLID_SKILL_TRADOVATE_NAME
  - SOLID_SKILL_TRADOVATE_PASSWORD
  - SOLID_SKILL_TRADOVATE_APP_ID
  - SOLID_SKILL_TRADOVATE_APP_VERSION
  - SOLID_SKILL_TRADOVATE_CID
  - SOLID_SKILL_TRADOVATE_SEC
```

### Exact manual next step for the user

1. A Tradovate trading login alone is **not** sufficient. Partner API
   application credentials (`appId`, `appVersion`, `cid`, `sec`) must be
   obtained separately, per Tradovate's own documentation:
   `https://support.tradovate.com/s/article/Tradovate-API-Access`. Whether
   the Apex-provisioned account/API key is eligible for this access at all is
   itself one of the open questions this checkpoint cannot resolve without
   it (see `TRADOVATE_RAW_CONTRACT.md` §5a, §15).
2. Once obtained, set these as **local environment variables only** — never
   committed, never placed in a source file, never logged:
   ```
   SOLID_SKILL_TRADOVATE_NAME=<Tradovate username>
   SOLID_SKILL_TRADOVATE_PASSWORD=<Tradovate password>
   SOLID_SKILL_TRADOVATE_APP_ID=<Partner API appId>
   SOLID_SKILL_TRADOVATE_APP_VERSION=<Partner API appVersion>
   SOLID_SKILL_TRADOVATE_CID=<Partner API cid>
   SOLID_SKILL_TRADOVATE_SEC=<Partner API sec>
   SOLID_SKILL_TRADOVATE_DEVICE_ID=<optional>
   SOLID_SKILL_TRADOVATE_ENVIRONMENT=demo   # or "live"; defaults to demo
   ```
3. Run `npm run dev:tradovate-real-qa`. It authenticates, calls
   `account/list`, then for every discovered account: `fill/list` (joined
   through `order/list` for `accountId` attribution, per the documented Fill
   schema — `TRADOVATE_RAW_CONTRACT.md` §5), `position/list`,
   `fillPair/list`, and `fillFee/deps?masterid=<fillId>` per captured fill.
   It prints a privacy-safe structural report (counts/shapes, masked account
   id — see below) and, if any fills were captured, writes one pseudonymized
   snapshot file to `.dev-data/tradovate/` (gitignored, never committed).
   **It never opens or imports anything from `src/main/persistence` or
   `src/main/trading`.**
4. Starting on the **demo** environment is strongly recommended before ever
   pointing this at `live`.

## What was built (real transport boundary)

`src/main/integrations/tradovate/realTransport.ts` —
`HttpTradovateTransport implements TradovateTransport`, a `fetch`-based
client against `https://demo.tradovateapi.com/v1` /
`https://live.tradovateapi.com/v1` (`TRADOVATE_RAW_CONTRACT.md` §3). It
implements exactly the interface in `transport.ts` — no more — so it is
**structurally incapable** of placing, modifying, or cancelling an order, or
touching a position/bracket, the same guarantee the spike established for
`FakeTradovateTransport`. `npm run smoke:tradovate`'s directory-wide
forbidden-pattern scan (`TRADOVATE_INTEGRATION_SPIKE.md` §7) now covers this
file too and passes.

The interface itself grew four read-only methods (`listOrders`,
`listPositions`, `listFillPairs`, `listFillFees`) so this checkpoint's
reconciliation-entity capture goes through the adapter boundary rather than a
one-off script, per the brief's explicit instruction. `TradovateAdapter`
gained matching passthrough methods. None of these four are consumed by
`normalizer/normalize.ts` — that structural guarantee from the spike
(§29a) is unchanged.

### Credential / secrets handling

`src/main/integrations/tradovate/credentials.ts`:
- Reads six required env vars (`name`/`password`/`appId`/`appVersion`/`cid`/`sec`)
  plus two optional ones (`deviceId`, `environment`). Never hardcodes,
  caches to disk, or writes a credential anywhere.
- `describeMissingTradovateEnv` reports variable **names** only.
- `maskTradovateCredentialName` / `maskTradovateAccountId`
  (`structuralReport.ts`) mask to the last 3 characters for any log line,
  matching the MT5 masking convention.
- Smoke-tested (`npm run smoke:tradovate`): 401/403 handled explicitly, a
  429 rate-limit response is handled safely (never retried in a loop,
  `Retry-After` preserved), malformed/non-array payloads are rejected
  explicitly (never partially parsed), a raw thrown network error is
  normalized to an `Error` and never leaks its raw text, no file in the
  integration passes a credential/token value to a logging call, and the
  real transport is a structural drop-in replacement for the fake transport
  behind the identical `TradovateAdapter` API.

### No SQLite write path

`realQa.ts` imports only `adapter.ts`, `credentials.ts`, `devSnapshot.ts`,
`normalizer/`, `realTransport.ts`, and `structuralReport.ts` — nothing from
`src/main/persistence` or `src/main/trading`, and no `node:sqlite` import
anywhere in the directory (smoke-tested statically). There is no code path,
in this checkpoint, by which a captured fact can reach the database.

### Snapshot / privacy behavior

`src/main/integrations/tradovate/devSnapshot.ts` mirrors
`src/main/integrations/mt5/devSnapshot.ts`: writes ONLY to
`.dev-data/tradovate/tradovate-raw-<pseudonym>.json`, already covered by the
repository's existing `.dev-data/` gitignore rule (smoke-tested). The account
id is replaced by a stable one-way SHA-256-derived pseudonym; fill/position
quantities, prices, timestamps, contract ids, and fill/order ids are
preserved verbatim, per the checkpoint's explicit instruction not to
pseudonymize structural relationships needed for analysis. No snapshot file
exists in this repository or working tree from this checkpoint — none was
ever written, because no real connection was attempted.

### Structural report shape

`src/main/integrations/tradovate/structuralReport.ts` produces exactly the
counts the checkpoint asked for: accounts/fills/positions/fillPairs/fillFees
found, fill action distribution (Buy/Sell), unique contract count, date
range, quantity distribution (min/max/distinct), completed/open/unresolved
candidate counts (from running the existing normalizer over the captured
fills in memory only), ambiguous/reversal case count, and rejected-fill
count. No full account id, username, token, order id, fill id, or raw
payload value is ever included.

## Real-vs-synthetic contract status

Unchanged from the spike/audit — **every schema claim in
`TRADOVATE_RAW_CONTRACT.md` remains PROVEN BY OFFICIAL DOCS, not PROVEN
AGAINST A REAL ACCOUNT**, because no real request was ever sent. All items in
`TRADOVATE_RAW_CONTRACT.md` §15 ("Remaining real-data unknowns") are still
open. In particular:

- Direction reconstruction, multiple-round-trip segmentation, and
  reversal/ambiguous handling: **UNTESTED against real data** — the existing
  synthetic proof (`TRADOVATE_INTEGRATION_SPIKE.md` §16–§22) is unchanged and
  is all that exists.
- `Position.id` real behavior, FillPair real semantics, and the
  FillFee→Fill linkage: **UNTESTED against real data** — still exactly as
  documented in the spike's §29a and the raw contract's §7/§9a.
- Real timestamp/tradeDate timezone behavior: **UNTESTED against real
  data** — still exactly as documented in the raw contract §10.
- Real JSON numeric precision (`TRADOVATE_RAW_CONTRACT.md` §15 item 7):
  `realTransport.ts`'s `numberToDecimalText` converts via
  `Number.prototype.toString()` after `JSON.parse` has already done an
  IEEE-754 double round-trip. This is flagged in the code as **best-effort,
  not proven exact** — a real payload may reveal precision loss that would
  require parsing raw response text instead of using `response.json()`
  semantics. Not yet tested against a real payload.

## Regression status

`npm run smoke:tradovate` (45/45, up from 32/32 — 13 new checks covering the
013B requirements), `npm run smoke:persistence` (111/111), `npm run
smoke:mt5` (38/38), `npm run smoke:mt5-normalizer` (35/35), `npm run
smoke:mt5-import` (39/39), `npm run smoke:mt5-reconciliation` (22/22), `npm
run smoke:i18n` (22/22), `npm run qa:active-account` (17/17), `npm run
typecheck`, `npm run build`. All pass. MT5 is completely unaffected — no MT5
file was touched by this checkpoint.

## Confirmed: no trading capability, no automatic wiring

- No write-capable method exists anywhere in
  `src/main/integrations/tradovate/` (static scan, unchanged guarantee,
  now also covering `realTransport.ts`).
- `isTradovateAdapterEnabled` (`index.ts`) is unchanged in behavior — it is
  still not consulted by `src/main/index.ts` or any IPC path. Real Tradovate
  connectivity is reachable **only** through the explicit, manual
  `npm run dev:tradovate-real-qa` development command — never from app
  startup, never from a reconnect path, never automatically.
- `subscribeToFills` on `HttpTradovateTransport` deliberately throws rather
  than silently no-op or guess a frame format — the live-event WebSocket path
  remains explicitly out of scope for this checkpoint
  (`TRADOVATE_RAW_CONTRACT.md` §14).

## What this checkpoint does NOT do

- Does not persist anything to SQLite (no import service exists for
  Tradovate; none was added).
- Does not implement the live WebSocket subscription.
- Does not resolve any of the "real-data unknowns" in
  `TRADOVATE_RAW_CONTRACT.md` §15 — resolving them requires a real
  credentialed run, which this checkpoint could not perform.
- Does not change the lifecycle-identity policy, direction rule, or reversal
  policy documented in the spike — those remain explicitly TEMPORARY pending
  real evidence.
