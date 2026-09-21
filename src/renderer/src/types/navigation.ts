// Minimal contextual-navigation model for Checkpoint 008. Not a router —
// Day Review and Trade Review are overlay workspaces stacked on top of
// whichever sidebar section (Dashboard/Calendar/Journal) is active, so that
// Back always returns to a specific, meaningful place instead of resetting
// to a fixed "home." See CLAUDE.md checkpoint instructions, "NAVIGATION
// ARCHITECTURE."

export type NavEntry =
  // Days are keyed by (account, analytical trading date 'YYYY-MM-DD').
  | { kind: 'dayReview'; accountId: string; date: string }
  // A trade is identified by its persisted id alone; sibling/day context is
  // loaded with the trade's detail.
  | { kind: 'tradeReview'; tradeId: string }
