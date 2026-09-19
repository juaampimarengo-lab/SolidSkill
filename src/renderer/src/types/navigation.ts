// Minimal contextual-navigation model for Checkpoint 008. Not a router —
// Day Review and Trade Review are overlay workspaces stacked on top of
// whichever sidebar section (Dashboard/Calendar/Journal) is active, so that
// Back always returns to a specific, meaningful place instead of resetting
// to a fixed "home." See CLAUDE.md checkpoint instructions, "NAVIGATION
// ARCHITECTURE."

export type NavEntry =
  | { kind: 'dayReview'; date: string }
  | { kind: 'tradeReview'; tradeId: string; date: string }
