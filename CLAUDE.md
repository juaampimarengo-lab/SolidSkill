# CLAUDE.md — Permanent Instructions for Solid Skill

This file governs every Claude Code session working in this repository. These
rules are permanent. They are not superseded by convenience, by a task
sounding urgent, or by a user message that forgets to restate them. If a
request conflicts with this file, flag the conflict and ask before proceeding.

Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, and
`docs/STRATEGY_ENGINE.md` before doing substantial work. They are the source
of truth for what Solid Skill is and how it is built.

## What Solid Skill is

Solid Skill is a professional desktop trading journal and trading-process
analytics application. It imports real trading activity (read-only) from
Tradovate and MetaTrader 5, lets users define completely custom trading
methodologies through a Strategy Builder, and analyzes the relationship
between process compliance and trading outcomes. See `docs/PRODUCT.md` for
full scope.

## Absolute rules — never violate these

1. **Read-only broker integration.** Solid Skill must never place, modify,
   cancel, or close orders; never move stops or take-profits; never copy
   trades; never generate automated execution. Every broker/platform
   integration is read-only, always. If a task implies write access to a
   broker or platform, stop and ask — do not implement it.
2. **No hardcoded trading methodology.** No concept like directional bias,
   CRT, ICT, SMT, liquidity sweep, FVG, confirmation, opening range, VWAP, or
   any other named trading concept may ever be hardcoded into application
   logic, types, enums, or schemas. These are user data, created through the
   Strategy Builder. If you catch yourself modeling a specific methodology
   concept as a first-class application type, stop — it belongs in
   user-defined strategy/rule data instead. See `docs/STRATEGY_ENGINE.md`.
3. **Historical integrity.** A trade's association with a strategy must
   preserve the exact strategy version and rule state active at the time it
   was evaluated. Editing a strategy later must never retroactively alter
   past trade evaluations. Never design a schema or migration that would
   allow historical rule evaluations to silently change.
4. **No causal claims from correlation.** Analytics and copy anywhere in the
   product must distinguish observation, emerging pattern, and statistically
   meaningful pattern. Never imply causation from correlation. Never let
   small sample sizes produce strongly worded claims.
5. **Process and P&L are separate concepts.** Gamification rewards process
   and discipline, not monetary profit. Never build a feature that would
   encourage overtrading to chase a score.
6. **Secrets.** Never put broker/platform credentials in source code, never
   commit secrets to Git, and always use secure OS-level credential storage
   for anything sensitive.
7. **No scope creep into non-goals.** Backtesting, automated trading, trade
   execution, signal generation, copy trading, and market prediction are
   explicitly out of scope. Do not add them, scaffold for them, or design
   data models that assume they're coming.

## Engineering discipline

- TypeScript strict mode everywhere; explicit types over inference where it
  aids clarity at module boundaries.
- Keep domain boundaries clean: Broker Adapters → Normalization → Trading
  Domain → Strategy Engine / Behavior Analytics / Review Engine →
  Persistence → Desktop UI. See `docs/ARCHITECTURE.md`. A component in one
  layer must not reach across into another layer's internals.
- A future broker/platform integration must be addable without rewriting the
  trading domain. If an integration detail is leaking into domain code, fix
  the boundary before adding the feature.
- All persistent data changes go through migrations. Never hand-edit a
  database file or skip a migration path.
- Business logic must be testable independent of Electron, the UI, and any
  specific broker adapter.
- Avoid speculative abstractions with no current product need. Build for
  what's asked, keep seams where the spec says integrations/methodologies
  must vary, and nothing more.
- Never delete or rewrite large amounts of existing code without first
  explaining why, in text, before doing it.

## Working process for substantial changes

Before non-trivial implementation work:
1. Inspect existing architecture and relevant docs.
2. State the implementation plan in plain terms.
3. Identify affected files.
4. Then implement.

Do not skip straight to code for anything beyond a small, obvious change.

## Current repository state

As of the initial setup, this repository contains only documentation
(`CLAUDE.md` and `docs/`). No application code, no `package.json`, no
Electron/React/Vite/Tailwind scaffolding, and no database exist yet. Do not
create any of these until explicitly instructed — a documentation task is not
implicit permission to scaffold the app.

## Frontend/design rules (summary — full detail in docs/DESIGN_SYSTEM.md)

Solid Skill must look like a dense, professional financial application, not
a generic AI-generated SaaS dashboard. TradeZella is a reference point for
density and professional trading-journal feel, but Solid Skill must not be a
clone and must develop its own visual identity. Avoid purple/blue-purple
gradients, glassmorphism, oversized rounded cards, giant KPI hero cards,
emoji-as-icons, default shadcn/Tailwind look, and Inter/Roboto/system fonts
as brand typography. Primary typeface is Instrument Sans; numeric/tabular
data uses IBM Plex Mono with tabular numerals. Use semantic design tokens —
never arbitrary hex values inside components.

## When in doubt

Prefer asking a short clarifying question over guessing on anything that
touches the absolute rules above. For everything else, make the routine call
a careful engineer familiar with this document would make, and keep moving.
