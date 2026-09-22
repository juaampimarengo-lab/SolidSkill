# Solid Skill — Conceptual Architecture

This document describes the conceptual architecture and domain boundaries of
Solid Skill. It intentionally does **not** finalize a database schema, pick
specific libraries beyond the already-stated direction, or specify file
layout — those are implementation decisions to be made when scaffolding
begins, informed by this document.

## Guiding principle

The broker/platform integration layer must remain fully separated from the
application's trading-domain model. A future integration (a third broker, a
different asset class) must be addable without rewriting core domain logic.
Nothing above the Normalization Layer should know which broker or platform a
trade came from, beyond a reference/attribution field.

## Layers

```
BROKER / PLATFORM
        ↓
ADAPTER
        ↓
NORMALIZATION
        ↓
TRADING DOMAIN
        ↓
JOURNAL / ANALYTICS
```

Expanded into the eight conceptual components used across the system:

1. **Broker / Platform Adapters**
2. **Normalization Layer**
3. **Trading Domain**
4. **Strategy Engine**
5. **Behavior Analytics Engine**
6. **Review Engine**
7. **Persistence Layer**
8. **Desktop UI**

### 1. Broker / Platform Adapters

One adapter per external platform (initially Tradovate, MetaTrader 5). An
adapter's only job is to speak that platform's protocol/API/file format and
produce raw, platform-shaped data: accounts, orders, fills, positions,
balances, as that platform represents them.

Adapters are strictly **read-only** — they must not expose any capability to
place, modify, cancel, or close orders, move stops/targets, or copy trades,
even if the underlying platform API supports it. This is enforced at the
adapter boundary, not left to caller discipline.

Adapters own:
- Authentication/session handling with the platform.
- Polling, subscription, or file-import mechanics specific to that platform.
- Translating platform-specific errors into a common adapter error shape.

Adapters do not know about strategies, rules, or analytics. They do not know
about each other.

### 2. Normalization Layer

Converts each adapter's raw, platform-shaped data into a common,
platform-agnostic shape: normalized trades, fills, instruments, accounts,
and account events. This is where platform quirks (contract naming,
fractional pip conventions, futures point values, prop-firm-specific account
states) get resolved into consistent domain-friendly values.

The Normalization Layer is the seam that makes the Trading Domain
broker-agnostic. Adding a third platform means writing a new adapter plus a
new normalization mapping — it must never require changes to the Trading
Domain, Strategy Engine, or Analytics layers.

### 3. Trading Domain

The core model of accounts, instruments, trades, executions, and positions,
independent of where the data came from. This layer defines what a "trade"
*is* for Solid Skill's purposes (e.g., how entries/exits group into a single
trade, how partial fills and scale-ins/outs are represented) and holds
account-level concepts like prop-firm evaluation state, balances, and
drawdown.

The Trading Domain has zero knowledge of specific trading methodologies. It
knows about trades and accounts, not about "liquidity sweeps" or "directional
bias."

### 4. Strategy Engine

The fully user-configurable system for defining trading methodologies:
strategies, strategy versions, rule groups, rules, conditions/dependencies,
and the evaluation of a given trade against a given strategy version,
producing a Trade Rule Result. See `STRATEGY_ENGINE.md` for full detail.

The Strategy Engine depends on the Trading Domain (it evaluates trades) but
the Trading Domain must never depend on the Strategy Engine — a trade is a
valid, complete domain object with or without any strategy attached.

Historical strategy/rule snapshots are owned by this layer: once a trade is
evaluated against a strategy version, that evaluation is immutable evidence,
independent of later edits to the strategy.

### 5. Behavior Analytics Engine

Analyzes relationships between rule compliance, strategy compliance, trade
outcomes (P&L, R multiple, points/ticks/pips), and contextual dimensions
(time of day, day of week, instrument, account, user-defined tags, trading
behavior).

This layer must clearly distinguish, in both its computed output and any
resulting UI copy:
- **Observation** — a single data point or small set of data points.
- **Emerging pattern** — a trend visible in limited data, stated tentatively.
- **Statistically meaningful pattern** — a trend supported by enough data
  and appropriate methodology to be stated with confidence.

It must never present correlation as causation, and must gate confident
claims behind sample-size and significance checks rather than surfacing raw
correlations as conclusions.

### 6. Review Engine

Owns the structured data behind Weekly Review: forecast/plan vs. what
actually happened, and intended process vs. actual behavior. This is stored
data (not just a computed view) so that plans, intentions, and outcomes can
be analyzed longitudinally later. The Review Engine reads from the Trading
Domain, Strategy Engine, and Behavior Analytics Engine but is itself a
distinct layer with its own persisted records (plans, reflections, review
periods).

### 7. Persistence Layer

Local SQLite database, accessed only by the layers above through explicit,
migrated schemas. No layer other than Persistence talks to the database
directly. Every schema change ships as a migration. The Persistence Layer
must support:
- Append-only or versioned storage where historical integrity is required
  (strategy versions, rule snapshots, trade rule results, review records).
- Secure storage of broker/platform credentials, separate from the general
  application database (e.g., OS credential store / encrypted secret
  storage), never as plaintext rows or files, never in Git.

### 8. Desktop UI

Electron + React + TypeScript, rendering the product areas described in
`PRODUCT.md`. The UI consumes the layers below through well-defined
interfaces and never talks directly to a broker adapter or the database. UI
components should not encode business rules that belong in the Trading
Domain, Strategy Engine, or Behavior Analytics Engine.

### MetaTrader 5 adapter path (Checkpoints 012 / 012B-1 / 012B-2)

```
MT5
 ↓
Read-only EA Adapter        integrations/mt5/ea/SolidSkillBridge.mq5   (compiled and run against a real account)
 ↓
Raw Deal Contract           docs/MT5_RAW_DEAL_CONTRACT.md
 ↓
MT5 Receiver                src/main/integrations/mt5/                 (built; in-memory raw staging)
 ↓
MT5 Normalizer              src/main/integrations/mt5/normalizer/      (built; pure; docs/MT5_NORMALIZATION.md)
 ↓
MT5 Import Service          src/main/integrations/mt5/import/          (built; idempotent; explicit dev gate only; docs/MT5_IMPORT.md)
 ↓
Trading Domain / SQLite
```

The Receiver and the Normalizer exist. The Receiver stages **raw deals** in
memory; the Normalizer is a pure function from raw deals to lifecycle
candidates (completed / open / unresolved) and touches no SQLite, Electron,
IPC, or renderer state. The Import Service (012B-2) maps only completed, proven candidates into Account/Trade/Executions through the repositories, idempotently by source lifecycle key (migration 002 adds the unique Trade source identity). It is invoked in two ways: an explicit development command (dry run by default, `MT5_IMPORT.md` §14, always available as QA/fallback) and, since Checkpoint 012B-4, an **opt-in, development-build-only** automatic reconciliation path (`MT5_RECONCILIATION.md`) that reuses the exact same importer after a complete history sync or a live deal, serialized/debounced per account. Neither startup nor reconnect ever imports unless one of these two explicit gates is enabled; a packaged production build never enables automatic reconciliation by default. The integration is **read-only**: the EA has no trading code and no
inbound channel, and Solid Skill never controls the account. See
`MT5_INTEGRATION_SPIKE.md`, `MT5_NORMALIZATION.md`, and `MT5_RECONCILIATION.md`.

### Tradovate adapter path (Checkpoint 013, spike)

```
Tradovate API (REST + WebSocket)
 ↓
Tradovate Adapter           src/main/integrations/tradovate/adapter.ts (built; read-only by construction)
 ↓
Raw Tradovate Facts         docs/TRADOVATE_RAW_CONTRACT.md
 ↓
Tradovate Raw Staging       src/main/integrations/tradovate/rawStaging.ts (built; in-memory)
 ↓
Tradovate Normalizer        src/main/integrations/tradovate/normalizer/ (built; pure; docs/TRADOVATE_INTEGRATION_SPIKE.md)
 ↓  ── not built yet ──
future Tradovate Import Service → Trading Domain / SQLite
```

Proven against a fake transport and synthetic fixtures (013); a real, `fetch`-based
`HttpTradovateTransport` implementing the identical read-only interface was
added in Checkpoint 013B (`realTransport.ts`), reachable only through the
manual `npm run dev:tradovate-real-qa` command — never from app startup or
any IPC path. No real Tradovate account access was available when 013B ran;
see `docs/TRADOVATE_REAL_QA.md` for what remains before any real connection
or persistence. Tradovate is a
**separate** adapter and normalizer from MT5 — it has its own raw-fact
contract and does not import MT5's raw types, and MT5 does not import
Tradovate's, per this document's "no upward knowledge" and "replaceability"
rules. `TradovateTransport` has no method that can place, modify, cancel, or
close an order or touch a position/bracket, so the adapter cannot expose
trading capability regardless of what a future real client library exposes.

### Chart Evidence / Trade Media (Checkpoint 014)

```
Renderer (upload picker / capture canvas)
 ↓
media IPC (src/main/ipc/registerMediaIpc.ts, mediaHandlers.ts)  — the only place besides the persistence/UI boundary that touches native dialogs/desktopCapturer
 ↓
MediaService (src/main/media/mediaService.ts)   — no Electron imports; stage → validate → write → persist
 ↓
MediaStorage (src/main/media/mediaStorage.ts) + MediaRepository (src/main/persistence/repositories/media.ts)
 ↓
userData/media/ files + SQLite trade_media table
```

A Journal/Review-layer concern, not a Trading Domain concern: it attaches
evidence to a Trade or a Day, and carries no methodology and no broker
knowledge. Images are read back by the renderer through a dedicated
`ssmedia://` protocol (main-process only, read-only, scoped to rows that
exist in the database), never through a generic filesystem API or IPC
channel. See `docs/TRADE_MEDIA.md`.

## Cross-cutting rules

- **Replaceability**: any single layer above should be replaceable (a new
  adapter, a swapped persistence engine, a rewritten UI) without forcing
  rewrites of unrelated layers. This is the practical test for whether a
  boundary is drawn correctly.
- **No upward knowledge**: lower layers (Adapters, Normalization, Trading
  Domain) must never import from or depend on higher layers (Strategy
  Engine, Analytics, Review, UI).
- **No methodology in the domain**: no layer below the Strategy Engine may
  encode a specific trading methodology concept. See `STRATEGY_ENGINE.md`.
- **Testability**: Trading Domain, Strategy Engine, Behavior Analytics
  Engine, and Review Engine must be testable in isolation, without Electron,
  without the UI, and without a live broker connection (using normalized
  fixture data).

## Explicitly deferred

This document intentionally does not yet define:
- Concrete database tables/columns or migration files.
- The exact adapter interface/contract.
- IPC boundaries between Electron main and renderer processes.
- Specific TypeScript module/package layout.

These will be defined when implementation begins, following the working
process in `CLAUDE.md` (inspect → plan → identify affected files →
implement).
