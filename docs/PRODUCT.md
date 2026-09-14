# Solid Skill — Product

## Purpose

Solid Skill is a professional desktop trading journal and trading-process
analytics application. Its purpose is to help discretionary and semi-
systematic traders understand and improve their *process* — not just their
P&L — by automatically importing real trading activity and evaluating it
against methodologies the trader themself defines.

Solid Skill is not a signal service, not an execution platform, and not a
backtester. It is a record-keeping and analysis tool that sits downstream of
trading activity that already happened.

## Core idea

Most journaling tools track outcomes. Solid Skill tracks outcomes *and*
process, and treats them as separate axes:

- **Outcome**: P&L, R multiple, points/ticks/pips, win/loss.
- **Process**: did this trade follow the rules the trader set for themself?

A losing trade can have excellent process. A winning trade can have poor
process. Solid Skill is built to keep those two judgments distinct and to
help the trader see how they relate over time.

## Data source model

Solid Skill imports real trading activity from external platforms. It never
originates trading activity itself.

### Initial integrations

1. **Tradovate** — Futures, including prop-firm evaluation/challenge
   accounts. Initial use case: Apex Trader Funding.
2. **MetaTrader 5** — Forex/CFD, initial use case: prop-firm accounts.

### Non-negotiable constraint: read-only

Solid Skill MUST NEVER, under any circumstance:

- place orders
- modify orders
- cancel orders
- move stop losses
- move take profits
- close trades
- copy trades
- generate automated execution

All broker/platform integrations exist solely to *read* historical and
current account/trade data for journaling and analysis. This is a permanent
product constraint, not a phase-one limitation to be lifted later.

## Main product areas

- **Dashboard** — top-level view of account health and recent activity.
- **Accounts** — connected broker/platform accounts, including prop-firm
  evaluation and funded accounts.
- **Trades / Journal** — the trade log: individual trades, annotations,
  screenshots/notes, and their strategy/rule evaluations.
- **Calendar** — time-based view of trading activity and outcomes.
- **Strategy Builder** — where users define their own methodologies,
  versions, rule groups, rules, and conditions (see `STRATEGY_ENGINE.md`).
- **Analytics** — behavior and outcome analytics, including rule-compliance
  vs. outcome relationships.
- **Weekly Review** — structured comparison of plan vs. actual and intended
  process vs. actual behavior, recorded over time.
- **Prop Firm tracking** — evaluation/challenge progress, drawdown limits,
  and funded-account rules relevant to prop trading.
- **Integrations** — management of broker/platform connections and
  credentials.
- **Settings** — application configuration.

## Explicit non-goals

Solid Skill will **not** become:

- A backtesting engine.
- An automated trading system.
- A trade execution platform.
- A signal-generation tool.
- A copy-trading service.
- A market-prediction engine.

These are permanent boundaries of the product, not sequencing decisions.
Features must not be designed in a way that assumes any of these are coming
later.

## Who this is for

Discretionary and semi-systematic traders — including those in prop-firm
evaluation programs — who already have (or want to build) an explicit
trading process, and want objective, historical evidence of whether they
are following it, and whether following it correlates with better results.
