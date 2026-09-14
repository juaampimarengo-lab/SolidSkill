# Solid Skill — Design System Principles

This document defines the visual and interaction principles for Solid
Skill. It does not define implementation details (no component library
decisions, no CSS framework setup) — those come when scaffolding begins. It
defines the rules that any future implementation must follow.

## Positioning

Solid Skill is a dense, professional, premium financial application. It
should feel closer to a serious trading terminal or institutional analytics
tool than to a consumer SaaS product. The bar is: would a professional
futures/forex trader trust this with their real account data at a glance?

TradeZella is a useful reference for information density, hierarchy, dark
financial UI, compact analytics, table design, navigation, and restrained
visual language. It is a reference point, not a template. Solid Skill must
not be a pixel-for-pixel clone and must develop its own distinct visual
identity — its own spacing rhythm, its own color usage, its own chart
treatment, its own type pairing.

## Anti-generic-AI-dashboard rules (hard constraints)

The following are explicitly banned from Solid Skill's UI:

- Generic AI dashboard aesthetics generally.
- The default/generic shadcn look, used without a considered design system.
- Huge rounded cards everywhere; excessive card-in-card nesting.
- Purple gradients, blue-purple gradients, or any decorative gradient.
- Random neon colors.
- Excessive glassmorphism or unnecessary glow effects.
- Oversized "hero" typography inside application screens (hero type belongs
  on marketing pages, not inside a working trading tool).
- Excessive whitespace used as a substitute for real information hierarchy.
- Giant KPI hero cards.
- Emojis used as UI icons.
- Default Tailwind styling applied without going through the design-token
  system.
- Arbitrary hex/rgb colors written directly inside components.
- Inter, Roboto, or the OS default font used as the primary brand typeface.

If a screen could be mistaken for a generic AI-generated dashboard template,
it is wrong, regardless of how functional it is.

## Typography

- **Primary interface typeface**: Instrument Sans. Used for navigation,
  labels, body copy, headings within the application shell.
- **Financial / numeric / tabular typeface**: IBM Plex Mono. Used for prices,
  P&L, R multiples, points/ticks/pips, account balances, dates in tables,
  and any other tabular financial data.
- All financial values must render with tabular numerals (fixed-width
  digits) so columns of numbers align vertically. This is a correctness
  requirement for a financial table, not a stylistic nicety.
- Both fonts should eventually be bundled locally with the desktop
  application rather than fetched from Google Fonts (or any remote source)
  at runtime. No runtime dependency on external font hosting.

## Color

- Near-black neutral application background. Charcoal, slightly elevated
  surfaces for panels/cards above that background. Subtle, neutral (not
  colorful) borders to separate regions.
- Color must be semantic and restrained:
  - **Emerald** — meaningful positive states only (e.g., profitable trade,
    rule respected, passed evaluation). Never decorative.
  - **Coral/red** — meaningful negative states only (e.g., losing trade,
    rule violated, failed evaluation). Never decorative.
  - **Amber** — warnings, break-even, caution states. Never decorative.
- No arbitrary accent colors invented per-screen. If a new state needs a
  color, it needs a token and a rationale, not a one-off hex value.
- Muted secondary typography color for supporting text/labels; strong,
  higher-contrast primary typography color for primary content and values.

## Design tokens

All color, spacing, radius, typography, and shadow values must be expressed
as semantic design tokens (e.g., a token meaning "positive financial value"
or "elevated surface background"), and components must consume those
tokens rather than inventing values inline. A component should never contain
a raw hex code, an arbitrary pixel value chosen ad hoc, or an inline
gradient. The token layer is what makes the anti-generic-AI rules
enforceable over time rather than a one-time review outcome — new work
should structurally be unable to introduce arbitrary colors.

Token categories to plan for once implementation begins (naming to be
finalized during scaffolding, principle fixed now):
- Background/surface levels (base, elevated, overlay).
- Border/divider strength levels.
- Text emphasis levels (primary, secondary, muted, disabled).
- Semantic state colors (positive, negative, warning, neutral/info).
- Spacing scale tuned for density, not for generous consumer-app whitespace.
- Restrained border-radius scale — sharp/precise, not the oversized rounded
  corners common to generic dashboard templates.
- Shadow scale that is subtle throughout; no heavy drop shadows, no glow.

## Density and layout

- Compact spacing and precise alignment throughout. This is a professional
  tool used for extended sessions, not a landing page — screen real estate
  should favor information over air.
- Tables are a first-class UI element and should be designed with the same
  care as any other component: legible at density, with clear alignment of
  numeric columns, restrained row separators, and sensible sorting/filtering
  affordances. No default/unstyled table rendering.
- Empty states should be deliberate and informative (what this screen will
  show once data exists, and what to do next) rather than a generic "no
  data" placeholder.
- Micro-interactions (hover states, transitions, loading states) should be
  deliberate, quick, and restrained — supporting the sense of precision, not
  adding decoration.

## Charts

Charts are treated as a designed part of the product, not the default output
of a charting library. That means: consistent use of the semantic color
tokens (not library default palettes), typography matching the rest of the
app (IBM Plex Mono for axis/value labels), restrained gridlines, and chart
types chosen for what they communicate (e.g., equity curve, R-multiple
distribution, compliance-vs-outcome breakdowns) rather than defaulted to
whatever the library ships first.

## How this document should be used

When implementation begins, this document is the checklist against which
early UI work is reviewed. Before adding a new color, font, card style, or
chart treatment, check it against the rules above. If a proposed UI pattern
isn't covered here, resolve it in the spirit of these rules (dense,
restrained, semantic, professional) and consider updating this document.
