# Solid Skill — Visual Foundation

Checkpoint 002. This document turns the principles in `DESIGN_SYSTEM.md`
into concrete, implementable values: typography scale, color tokens,
geometry, density rules, and per-surface visual grammar. It is the
reference future implementation work must match token-for-token.

This document does not create application code, does not choose a CSS/token
tooling implementation (CSS variables vs. a JS theme object vs. Tailwind
config — that is a scaffolding-time decision), and does not install
anything. It fixes *values and rules*, not *mechanism*.

TradeZella remains a density/professionalism reference, not a template.
Every value below is chosen to feel like deliberate, mature financial
software — not a recognizable clone of any single product.

---

## 1. Typography

### 1.1 Families

- **UI family — Instrument Sans**: navigation, labels, body copy, headings,
  buttons, form controls, widget titles, page titles.
- **Numeric family — IBM Plex Mono**: prices, P&L, R multiples, ticks/
  points/pips, balances, percentages, quantities, durations, timestamps in
  tables, any value a trader needs to visually compare down a column.
- Both fonts must ship as local static assets bundled with the app at
  implementation time. No Google Fonts / remote font requests at runtime.

Rule of thumb: if a value could ever appear in a column with other values of
the same kind, it is IBM Plex Mono with tabular numerals. If it is prose,
a label, or a proper noun (instrument name, strategy name, account name),
it is Instrument Sans.

### 1.2 Weights

Instrument Sans:
- 400 Regular — body copy, table cell text, secondary labels.
- 500 Medium — default UI weight: nav items, buttons, widget titles, form
  labels, table headers.
- 600 Semibold — page titles, section titles, emphasized values, active nav
  item.

IBM Plex Mono:
- 400 Regular — table numeric cells, secondary numeric text.
- 500 Medium — default weight for standalone numeric values (KPI rows,
  widget summary numbers).
- 600 Semibold — reserved for the single "headline" number in a widget
  (e.g., a widget's one primary metric), used sparingly.

Never use a weight below 400 or above 600 anywhere in the app. No 700/800
"hero" weights — that belongs to marketing sites, not this tool.

### 1.3 Type scale

All sizes in px at 100% OS scaling; line-height as a unitless multiplier.

| Token | Size | Line height | Weight | Letter spacing | Use |
|---|---|---|---|---|---|
| `text-micro` | 11 | 1.3 | 500 | +0.02em | Table header labels, badges, overline labels |
| `text-caption` | 12 | 1.35 | 400 | +0.01em | Captions, helper text, timestamps, metadata |
| `text-label` | 12 | 1.3 | 500 | +0.01em | Form labels, widget field labels |
| `text-body-sm` | 13 | 1.45 | 400 | 0 | Table cell text, dense body copy |
| `text-body` | 14 | 1.5 | 400 | 0 | Default body copy, form inputs |
| `text-nav` | 13 | 1.3 | 500 | 0 | Sidebar navigation items |
| `text-widget-title` | 13 | 1.3 | 500 | +0.01em | Widget/panel titles (often uppercase-tracked) |
| `text-section-title` | 15 | 1.3 | 600 | 0 | Section headers within a page |
| `text-page-title` | 20 | 1.25 | 600 | -0.01em | Top-of-page title (max size in the whole app) |
| `text-table-cell` | 13 | 1.3 | 400 | 0 | Standard table cell (Plex Mono for numeric cells) |
| `text-kpi-value` | 22 | 1.2 | 500 | -0.01em | Primary metric value in a compact analytical block. Default KPI/financial-metric ceiling. |
| `text-kpi-value-sm` | 16 | 1.2 | 500 | -0.005em | Secondary/inline metric values |
| `text-kpi-value-lg` | 28 | 1.15 | 600 | -0.01em | Rare exception: the single primary metric of a major screen or section, when hierarchy genuinely requires it. Hard application-wide ceiling — never used for more than one metric on a screen. |

Notes:
- `text-page-title` at 20px is the ceiling for standard application chrome
  (nav, headings, page titles). It is not the absolute ceiling for the
  whole app — see `text-kpi-value-lg` below.
- `text-kpi-value` at 22px is the **default** KPI/financial-metric ceiling
  and should be used for the overwhelming majority of metrics — this is
  not a hero-card number, it should read as "clearly the important number
  in this block," not as a marketing headline.
- `text-kpi-value-lg` at 28px is a **rare, explicit exception**: a major
  screen or section (e.g. the Dashboard's account equity, or a single
  standout metric in Analytics) may promote its one genuinely primary
  metric to 28px when 22px would understate its hierarchy. This is a hard
  ceiling — nothing in the application renders text larger than 28px, and
  no screen uses this exception for more than one metric at a time. If a
  screen wants two "big" numbers, both stay at 22px; promoting more than
  one metric per screen defeats the purpose of the exception and is a
  defect, not a design choice.
- Widget titles are frequently rendered with a small amount of letter
  spacing and a muted color (see §2) to read as a label, not a heading.

### 1.4 Tabular numerals

- Every numeric value rendered in IBM Plex Mono uses `font-variant-numeric:
  tabular-nums` (Plex Mono is monospaced by design, but this is stated
  explicitly as a hard requirement, not an assumption).
- Any column of numeric values (table columns, stacked KPI rows, calendar
  cell P&L) must right-align and share the same numeric size/weight token
  so digits stack vertically without visual drift.
- Signed values (P&L, R multiple) reserve a fixed leading position for the
  sign or use a consistent `+`/`-` prefix — never let the presence/absence
  of a sign shift decimal alignment.

---

## 2. Color System

Base palette: neutral, near-black, desaturated. No hue drift toward blue or
purple in neutrals — neutrals are true/warm-neutral gray, not "dark mode
blue-gray," which is one of the most common tells of a generic AI dashboard.

### 2.1 Surface & structure tokens

| Token | Value (hex) | Notes |
|---|---|---|
| `bg-app` | `#0B0C0E` | Application root background |
| `bg-sidebar` | `#0D0E10` | Sidebar — marginally distinct from app bg |
| `bg-topbar` | `#0D0E10` | Top bar — matches sidebar for a continuous shell |
| `surface-primary` | `#131417` | Default panel/widget/card surface |
| `surface-secondary` | `#17181C` | Nested surface within a primary surface (used sparingly) |
| `surface-elevated` | `#1C1E22` | Modals, dropdowns, popovers, menus |
| `surface-hover` | `#1A1B1F` | Hover state for rows/interactive surfaces |
| `border-subtle` | `#232529` | Default dividers, table borders, panel outlines |
| `border-strong` | `#33363C` | Emphasized borders: focused input outline base, active dividers |

### 2.2 Text tokens

| Token | Value (hex) | Use |
|---|---|---|
| `text-primary` | `#E7E8EA` | Primary content, values, headings |
| `text-secondary` | `#A6A9B0` | Secondary copy, inactive nav labels, descriptions |
| `text-muted` | `#6B6E76` | Captions, placeholders, disabled text, timestamps |
| `text-disabled` | `#4A4C52` | Disabled controls |
| `text-helper` | `#8B8E96` | Readable supporting prose — helper lines under section headings, empty states, explanatory process text. Sits between secondary and muted so helper copy is legible without competing with data (Checkpoint 015). |

### 2.3 Semantic state tokens

| Token | Value (hex) | Use |
|---|---|---|
| `positive` | `#3DD68C` | Profitable P&L, rule respected, passed evaluation |
| `positive-subtle` | `#1B3B2C` | Positive background tint (badges, cell backgrounds) |
| `negative` | `#E5615A` | Losing P&L, rule violated, failed evaluation |
| `negative-subtle` | `#3B211F` | Negative background tint |
| `warning` | `#D9A441` | Break-even proximity, caution, approaching limits |
| `warning-subtle` | `#3A3020` | Warning background tint |
| `break-even` | `#8A8D95` | Neutral outcome — deliberately gray, not amber (approved; see §2.4 and §7) |
| `accent-cool` | `#4C8DFF` | Restrained cool accent — focus rings, selected state, active navigation state, active filter/tab, and informational semantic state (when a semantic color is required and none of positive/negative/warning apply). Never decorative. |
| `selection` | `#22303F` | Selected row/cell background |

Design rationale for `accent-cool` being the one blue in the palette:
blue is scoped to interaction/state signaling — focus, selection, "this is
currently active" — never to branding or decoration. It must never compete
visually with P&L semantic colors (positive/negative/warning), and it must
never become a blue SaaS theme: no blue surfaces, no blue buttons-as-brand,
no blue used just because a control needs *a* color. When in doubt, prefer
a neutral token; reach for `accent-cool` only for the specific state
categories listed above.

### 2.3a Violet accent tokens (Checkpoint 015, approved)

| Token | Value (hex) | Use |
|---|---|---|
| `accent-mid` | `#968BFF` | Section-heading icons, primary progress fill, earned-chip icon, the selected score's border |
| `accent-soft` | `#C3BDFF` | Section-heading text, the selected score's numeral |
| `accent-muted` | `#7C76B3` | Secondary progress fill, scores below the selected one |
| `accent-subtle` | `#1B1A29` | Low-emphasis tint behind an earned chip / the chosen score range — small areas only |
| `accent-border` | `#3A3566` | Border of an earned chip, notice left-rule, score range |

The violet accent marks **structure and process emphasis**: where a section
starts, how far a review has progressed, what has been earned or chosen. It is
applied flat — never as a gradient, never as a large background fill, never as
a surface color. It never colors a P&L value or any outcome polarity (those
stay `positive` / `negative` / `break-even`), and it does not replace
`accent-cool` for focus / selection / active-navigation state. First used in
Weekly Review; other screens adopt it only deliberately.

### 2.4 Rules

- Emerald/coral/amber are **never** decorative. If a static UI element (an
  icon, a border, a background) is not communicating a real positive/
  negative/warning state, it uses a neutral token.
  - `positive-subtle` / `negative-subtle` / `warning-subtle` exist for
  low-emphasis contexts (badges, calendar cells, table row tints) where a
  full-saturation color would be too loud at density.
- `break-even` is intentionally gray rather than amber (approved decision).
  Amber (`warning`/`warning-subtle`) is reserved exclusively for
  warning/caution semantics (e.g., approaching a drawdown limit) and must
  never be used for break-even, which prevents overloading amber with two
  different meanings.
- `accent-cool` is scoped to: focus indicator, selected state, active
  navigation item, active filter/tab, and informational semantic state. It
  is never used decoratively, never used as a brand/hero color, and never
  allowed to visually compete with `positive`/`negative`/`warning` (e.g.,
  it should not appear adjacent to a P&L value in a way that reads as a
  fourth outcome color).
- Dark mode is the only mode for checkpoint 002. A light theme is not
  designed here and must not be assumed by token naming (tokens are named
  by role, e.g. `bg-app`, not by literal color, so a future light theme
  is possible without a rename).

---

## 3. Geometry

| Token | Value | Notes |
|---|---|---|
| `sidebar-width` | 232px | Expanded sidebar |
| `sidebar-width-collapsed` | 56px | Icon-only collapsed state |
| `topbar-height` | 48px | Fixed height, always visible |
| `page-gutter` | 24px | Left/right page padding at standard density |
| `page-gutter-compact` | 16px | Left/right page padding at compact density |
| `section-spacing` | 20px | Vertical gap between major page sections |
| `widget-padding` | 14px | Internal padding of a widget/panel |
| `widget-gap` | 12px | Gap between widgets in a grid |
| `table-row-height` | 36px | Standard density |
| `table-row-height-compact` | 30px | Compact density |
| `table-header-height` | 32px | Table header row |
| `input-height` | 32px | Text inputs, selects |
| `button-height-sm` | 28px | Secondary/inline buttons |
| `button-height-md` | 32px | Default button |
| `button-height-lg` | 36px | Primary page-level actions (rare) |
| `radius-sm` | 4px | Inputs, buttons, badges, table cells (if any) |
| `radius-md` | 6px | Widgets, panels, cards |
| `radius-lg` | 8px | Modals |
| `radius-dropdown` | 6px | Dropdowns, popovers, menus |
| `radius-modal` | 8px | Explicit modal token (same as `radius-lg`, named separately for clarity in usage) |
| `chart-padding` | 12px top/right, 8px bottom, 40px left (for axis labels) | Internal chart plot padding |

Radius ceiling for the entire application is 8px (`radius-modal`). Nothing
is ever `rounded-xl`/`rounded-2xl` or pill-shaped except genuinely pill
elements (status dots, small count badges where a circle is semantically
correct).

---

## 4. Density

Two conceptual modes, `standard` and `compact`, expressed through the
geometry tokens above (row height, gutters) rather than through separate
type scales — text size stays constant between modes; spacing and row
height contract.

- **Standard** — default. `table-row-height: 36px`, `page-gutter: 24px`.
  Suitable for most screens.
- **Compact** — opt-in (user preference, to design the toggle for later, not
  to build now). `table-row-height: 30px`, `page-gutter: 16px`,
  `widget-padding: 10px`. Intended for users who want maximum rows-per-
  screen in the Journal/Trades table especially.

**Decision (Checkpoint 002 review, approved):** Compact density stays fully
specified in this document but is not implemented in the first UI
scaffold — initial implementation uses `standard` density exclusively.
Every density-sensitive token (row heights, gutters, widget padding) must
remain named/structured so `compact` is a later value swap applied through
the existing tokens, not a redesign or a rearchitecture. No component or
layout decision made during initial scaffolding may hardcode a
`standard`-only assumption (e.g. baking `36px` into a component instead of
referencing `table-row-height`) that would make adding `compact` later
require structural rework.

General density rule: whitespace is a spacing decision, not a hierarchy
substitute. Hierarchy comes from type weight/size and color, not from
adding air around an element.

---

## 5. Navigation

### 5.1 Primary sidebar

- Fixed width per §3, dark background (`bg-sidebar`), separated from the
  main content area by `border-subtle` only (no shadow).
- Sections: workspace/account context at top, primary nav items below,
  secondary/utility items (Settings, Integrations) pinned to the bottom.
- Nav items: `text-nav` (13px/500), `text-secondary` color when inactive.
- **Active item**: `text-primary` color, `surface-secondary` background
  pill behind the item (radius `radius-sm`), optionally paired with a thin
  (2px) `accent-cool` left-edge indicator — this is the one place in
  navigation a color is used, and it is the restrained cool accent (never
  `positive`), consistent with §2.4's scope for `accent-cool` as an active/
  selected-state signal, not an outcome color.
- **Hover (inactive item)**: background steps to `surface-hover`, text
  stays `text-secondary` (does not jump straight to primary — reserves that
  transition for actual selection).
- Icons, where used, are a single-weight linear icon set at 16px, always
  `text-secondary`/`text-primary` matching the item's text state — never a
  colored decorative icon.

### 5.2 Account / workspace context

- A compact account selector sits above the nav list: account name (Instrument
  Sans, `text-body-sm`, 500) + account type/broker badge (small, muted,
  Plex Mono if it includes a number like balance) + current balance in Plex
  Mono, right-aligned within the control.
- Clicking opens a dropdown (`surface-elevated`, `radius-dropdown`) listing
  connected accounts, grouped by broker/platform, with a persistent "Manage
  Integrations" row at the bottom — never mixed inline with account rows.

### 5.3 Top toolbar

- Height per §3, `bg-topbar`, bottom border `border-subtle`.
- Left: contextual page title (`text-page-title`) and optional breadcrumb.
- Right: date range selector, then the global data-representation switcher,
  then page-specific actions (rightmost).

### 5.4 Date range selector

- A single compact control (button height `button-height-md`), showing the
  resolved range in Plex Mono (e.g. `Aug 1 – Aug 31`), opening a popover
  with presets (Today, This Week, This Month, This Quarter, YTD, Custom)
  stacked left and a calendar range-picker to the right of presets inside
  the popover. No oversized date-range hero UI.

### 5.5 Global data-representation switcher

- A segmented control (not a dropdown — these are frequent, low-friction
  switches) with tokens: `$`, `%`, `R`, `ticks/pts`. Height matches
  `button-height-sm`, each segment ~32px wide, Plex Mono labels.
- Active segment: `surface-secondary` background, `text-primary`, with a
  thin `accent-cool` bottom-edge or full-segment outline permitted where it
  improves scanability. Inactive: transparent, `text-muted`. No outcome
  color (positive/negative) is ever applied to the switcher itself — it is
  a mode control, not a value.
- This switcher is global-scoped per page (affects all P&L-bearing widgets
  on that page at once), not per-widget, to avoid the page telling
  contradictory stories in different units simultaneously.
- The same pattern applies to any other active filter/tab control in the
  app (e.g. a filter chip row, a tab strip): the active item may use
  `accent-cool` (background tint, underline, or outline) to mark itself as
  selected, per §2.4's scope for the token — inactive items stay neutral.

---

## 6. Data Display

General principle: **color is applied to the fact, not to every number.**
A table full of colored digits is harder to scan than one where color marks
only the handful of values that need a fast positive/negative read.

- **P&L**: Plex Mono, signed (`+$482.00` / `-$210.50`), colored
  `positive`/`negative`. This is a case where color earns its place — P&L
  sign is the single most scanned fact in the product.
- **Percentages**: Plex Mono, one decimal by default (`+2.4%`). Colored
  only when representing a P&L-derived percentage (return); colored
  neutral (`text-primary`) when representing a non-outcome percentage
  (e.g., "68% rule compliance" is not colored green/red — compliance is a
  process metric, not an outcome one, and must not visually borrow outcome
  semantics per `PRODUCT.md`'s process/outcome separation).
- **R multiples**: Plex Mono, one decimal, suffixed `R` (`+1.8R`), colored
  positive/negative like P&L.
- **Ticks/points/pips**: Plex Mono, integer or platform-appropriate
  precision, colored positive/negative, always paired with a unit
  abbreviation in `text-muted` (e.g. `42 pts`) so raw numbers are never
  ambiguous between instruments.
- **Win/Loss/Break-even**: small text badge (`text-micro`, `radius-sm`,
  `*-subtle` background + matching solid text color); break-even uses the
  neutral `break-even` token, not amber (§2.4).
- **Drawdown**: Plex Mono, always negative-signed or presented as "% of
  limit used" (e.g. `62% of max DD`), colored `warning` once past a
  configurable threshold (e.g. 70–100% of limit) and `negative` only if the
  limit is breached — drawdown gets a three-state color ramp
  (neutral → warning → negative), not a binary one, since proximity to a
  limit is itself meaningful information for prop-firm accounts.
- **Account balances**: Plex Mono, `text-primary`, never colored
  positive/negative by default (a balance is a fact, not a result) —
  color only applies to the *change* shown alongside it, if any.
- **Timestamps**: Plex Mono, `text-muted`, consistent format
  (`HH:mm:ss` intraday in tables, `MMM D` in lists/calendars).
- **Trade duration**: Plex Mono, `text-secondary`, compact format
  (`4m 12s`, `1h 08m`) — never raw seconds, never a verbose "1 hour, 8
  minutes."
- **Quantities**: Plex Mono, `text-primary`, unit-suffixed where the
  instrument's unit isn't obvious from context (contracts, lots).

---

## 7. Tables

- Row height: `table-row-height` (36px standard / 30px compact); header
  height `table-header-height` (32px).
- **Header treatment**: `text-micro` (11px/500, +0.02em), `text-muted`,
  uppercase, no background differentiation beyond a `border-subtle` bottom
  rule — headers are quiet, not boxed or shaded.
- **Alignment**: text/label columns left-aligned; all numeric columns
  right-aligned; a leading status/indicator column (win/loss dot, checkbox)
  is fixed-width and center-aligned.
- **Numeric alignment**: every numeric column shares one Plex Mono
  size/weight per table so digits from row to row line up exactly; decimal
  points align via consistent fixed-precision formatting, not by
  visually padding differently-precise numbers.
- **Row hover**: background → `surface-hover`, no scale/shadow change, no
  transition longer than 100ms.
- **Row selected**: background → `selection` (a dark `accent-cool`-derived
  tint), optionally paired with a thin `accent-cool` left-edge indicator
  consistent with the active-nav-item pattern in §5.1 — selection is
  communicated by the cool accent family, never by an outcome color.
- **Borders**: horizontal `border-subtle` rules between rows only; no
  vertical column borders by default (column separation comes from
  alignment + spacing, not ruling).
- **Zebra-striping**: not used. At this density, zebra striping adds visual
  noise; row separation comes from the subtle horizontal rule plus hover/
  selection states.
- **Density**: tables default to `standard` row height but are the primary
  beneficiary of `compact` mode — the Trades/Journal table in particular
  should read as materially denser in compact mode.
- **Pagination/footer**: a slim footer bar (height = `table-row-height`)
  showing row count ("128 trades") left, and page controls right, using
  `text-caption`/`text-body-sm` — never a large, isolated pagination
  component floating below whitespace. Infinite/virtualized scroll is
  preferred for the Journal table where feasible; pagination is the
  fallback pattern, not the default aspiration.

---

## 8. Widgets / Analytics — visual grammar

Analytical modules are **compact analytical blocks**, not floating hero
cards. A widget is: a title row, then either an aligned metric row/grid or
a chart, inside one `surface-primary` container with `widget-padding` and
`radius-md`. Widgets sit in a strict grid (`widget-gap` between them) —
never freely positioned, never nested inside another widget's surface.

Rules:
- One elevation level per widget (`surface-primary`). No card-inside-card.
  A widget that needs to show sub-groups uses spacing and a thin
  `border-subtle` divider, not a nested surface color.
- No icon-per-metric decoration. An icon may appear once, next to the
  widget title, if it clarifies the module's topic — never repeated next to
  every value inside it.
- Metric values share a baseline within a row; multi-metric rows align on
  a shared grid (CSS grid columns, not manually spaced flex items) so
  labels and values line up across rows.
- `text-kpi-value` (22px) is reserved for a widget's single headline metric,
  if it has one. A widget showing 4–6 related metrics uses `text-kpi-value-sm`
  (16px) for all of them uniformly — no single metric in a multi-metric
  widget is blown up disproportionately.

### 8.1 ASCII: BAD vs GOOD widget layout

**BAD — generic AI dashboard card grid:**

```
┌──────────────────────────┐  ┌──────────────────────────┐
│                          │  │                          │
│   💰                     │  │   📈                     │
│                          │  │                          │
│      $12,480.00          │  │        +18.4%            │
│                          │  │                          │
│   Total P&L              │  │   Win Rate               │
│                          │  │                          │
└──────────────────────────┘  └──────────────────────────┘
   ^ oversized number            ^ decorative emoji icon
   ^ huge empty padding          ^ isolated floating card
   ^ centered layout             ^ no relation to neighbors
```

**GOOD — compact analytical block:**

```
┌ PERFORMANCE ──────────────────────────────────────────┐
│ Total P&L        Win Rate        Avg R        Trades  │
│ +$12,480.00      58.4%           +1.6R        84      │
│ ─────────────────────────────────────────────────────  │
│ Best Day         Worst Day       Avg Duration          │
│ +$2,140.00       -$980.00        24m 10s               │
└─────────────────────────────────────────────────────────┘
   ^ shared grid, aligned baselines, one surface, no icons,
     restrained type size, dense but scannable
```

### 8.2 ASCII: BAD vs GOOD page composition

**BAD:**

```
┌────────┐ ┌────────┐ ┌────────┐
│ KPI 1  │ │ KPI 2  │ │ KPI 3  │   <- 3 disconnected hero cards
└────────┘ └────────┘ └────────┘

        (large empty gap)

┌──────────────────────────────┐
│  ┌────────┐                  │
│  │ nested │   Chart Card      │   <- card inside a card
│  └────────┘                  │
└──────────────────────────────┘
```

**GOOD:**

```
┌ ACCOUNT SUMMARY ───────────────┬ EQUITY CURVE ──────────────┐
│ Balance   Today    Open P&L    │  (quiet line chart,         │
│ $48,210   +$340    -$120       │   Plex Mono axis labels)    │
├─────────────────────────────────┴──────────────────────────┤
│ COMPLIANCE                                                   │
│ Rules Respected   Rules Violated   Strategy Adherence        │
│ 112               18               86%                       │
└────────────────────────────────────────────────────────────┘
   ^ grid-aligned regions, shared borders, no redundant cards
```

---

## 9. Charts

- Charts render on `surface-primary` (no separate chart background), using
  `chart-padding` from §3.
- **Grid lines**: horizontal only by default, `border-subtle` at reduced
  opacity (visually quieter than table borders), never both axes gridded
  unless the chart type requires it (e.g. scatter/heatmap).
- **Axes**: no axis line boxing the whole plot; a single thin baseline
  where zero falls (important for P&L curves — the zero line is
  `border-strong`, distinct from grid lines, since it's a meaningful
  reference, not decoration). Axis labels: Plex Mono, `text-muted`,
  `text-caption` size.
- **Labels**: minimal tick count (prefer 4–6 y-axis ticks over a dense
  ruler); no chart titles duplicated inside the plot (the widget title
  above already names it).
- **Tooltip**: `surface-elevated`, `radius-sm`, Plex Mono values, appears
  on hover only, no animation beyond a fast (≤100ms) fade — never a
  bouncy/scaling tooltip.
- **Positive/negative series**: equity/P&L curves use a single neutral
  line color (`text-secondary`) for the line itself with `positive-subtle`/
  `negative-subtle` area fill *below/above* the zero baseline respectively
  — this reads as "P&L relative to breakeven" rather than recoloring the
  whole line, which tends to look noisy over a long series.
- **P&L curve**: line chart as above; no gradient fill beyond the flat
  subtle-tint fill described.
- **Drawdown**: area chart from 0 down to current drawdown, `negative-subtle`
  fill, `negative` line, with a `warning`-colored horizontal threshold line
  where a limit applies (prop-firm max drawdown).
- **Distribution** (e.g. R-multiple histogram): bar chart, bars colored
  `positive`/`negative` per-bucket based on bucket sign, `border-subtle`
  gaps between bars, no rounded bar tops beyond `radius-sm`.
- **Heatmaps** (e.g. time-of-day performance): cell color interpolates
  through a single-hue-per-sign ramp — `negative` ramp for loss cells,
  `positive` ramp for profit cells, both desaturating toward
  `surface-secondary` near zero — never a rainbow/multi-hue heatmap scale.

---

## 10. Calendar

- Monthly grid, 7 columns, fixed cell aspect (wider than tall — this is a
  data cell, not a square consumer-calendar cell).
- **Daily P&L**: Plex Mono, `text-kpi-value-sm` size, colored
  positive/negative, right-aligned or centered depending on final layout,
  consistent across all cells.
- **Win/loss/break-even state**: a subtle full-cell background tint
  (`positive-subtle`/`negative-subtle`, `break-even` gray at low opacity)
  rather than a colored border — keeps the grid calm at a glance while
  still scannable.
- **Trade count**: `text-caption`, `text-muted`, small, bottom-left of the
  cell (e.g. `3 trades`).
- **Note indicator**: a small dot/glyph, `text-muted`, top-right of the
  cell — never a full icon, never colored (a note's presence is
  informational, not a state).
- **Selected day**: `border-strong` outline around the cell, no background
  change beyond its existing win/loss tint.
- **Today**: a small `accent-cool`-colored dot or thin top-edge accent —
  distinct from selection, never conflated with it.
- **Hover**: background lightens one step (toward `surface-hover`) blended
  with the existing win/loss tint, no scale/shadow.
- **Days outside active month**: `text-disabled` date number, tint reduced
  to ~40% opacity, still shows data if present but visually recedes.

Cells stay information-dense (date, P&L, trade count, note indicator) but
never add more than those four data points — anything else belongs in a
day-detail view on click, not crammed into the cell.

---

## 11. Strategy Builder

Visual language only — no methodology-specific concepts, per
`STRATEGY_ENGINE.md`. Every example below is a structural/generic label.

- **Strategy list**: simple row list (table-like, `table-row-height`),
  name + instrument/tag chips (neutral `surface-secondary` chips, never
  colored) + version count + last-modified date (Plex Mono).
- **Strategy version**: shown as a small `vN` badge (Plex Mono, `text-muted`
  on `surface-secondary`) next to the strategy name; a version history is a
  simple vertical list, most recent first, each entry showing version
  number, date, and a change summary — never destructive-looking (no red)
  since a new version is a normal, expected action, not an error state.
- **Rule group**: a bordered section (`border-subtle`, `radius-md`) with a
  `text-section-title` header the user names themselves; groups stack
  vertically with `section-spacing` between them.
- **Checklist item (rule)**: a row with a leading state control (checkbox/
  tri-state), the user's rule text (`text-body`), and a trailing kind
  badge:
  - **Mandatory**: small solid badge, `text-primary` on `surface-secondary`,
    label "Required" — deliberately neutral-colored, not red/alarming,
    since "required" is a structural fact, not a warning.
  - **Optional**: outlined badge (`border-subtle`, transparent fill),
    `text-muted`, label "Optional."
  - **Conditional**: outlined badge, `text-secondary`, label "Conditional,"
    with a small branch glyph and a hover/expand affordance showing the
    dependency text (e.g. "Requires: Rule A").
- **Pass / Fail / Not applicable** (Trade Rule Result states, shown when
  reviewing a trade against a strategy): small status glyph + label —
  Pass uses `positive`, Fail uses `negative`, Not applicable uses
  `text-muted` with a neutral dash glyph, never a color (N/A is not a
  negative signal and must not read as one).
- **Flow/diagram view**: nodes are rule cards (`surface-secondary`,
  `radius-sm`, minimal padding, just the rule name + kind badge),
  connected by thin `border-strong` lines with small arrowheads for
  dependency direction; layout is a simple top-to-bottom or left-to-right
  tree — no decorative curves, no drop shadows on nodes, no color-coding
  of connections beyond a single neutral line color. This view is a
  generic dependency-graph renderer; it must remain fully agnostic to what
  any node's label means.

---

## 12. Micro-interactions

- **Hover**: 80–100ms ease-out background/color transition. No transform,
  no scale, no shadow-on-hover.
- **Focus**: `accent-cool` token as a 2px outline (or 1px outline + 1px
  offset), applied consistently to every interactive element; never
  removed without a replacement visible indicator.
- **Selected states**: background (`selection`) per §6/§7, optionally with
  a thin `accent-cool` edge indicator (§5.1/§7) — always the cool accent
  family, never an outcome color, to keep a single consistent "selected"
  signature app-wide.
- **Drawers**: slide in from the right, 150–200ms ease-out, covering a
  fixed max-width (not full-bleed) with a low-opacity scrim
  (~`rgba(0,0,0,0.4)`) over the rest of the app; closing reverses the same
  transition, no bounce/overshoot easing.
- **Modals**: center-anchored, `surface-elevated`, `radius-modal`, fade +
  4px translate-up on enter (≤150ms), same scrim as drawers. No scale-in
  ("zoom") entrance — that reads as consumer/mobile, not desktop-pro.
- **Tooltips**: ≤100ms fade, 4px offset from trigger, no arrow-bounce.
- **Loading states**: inline skeletons matching the exact geometry of the
  content they replace (same row height, same column widths) — never a
  generic centered spinner for anything that has a known layout. A spinner
  is acceptable only for full-page/first-load states with no layout yet to
  mimic.
- **Skeletons**: `surface-secondary` blocks with a slow (~1.5s), low-
  amplitude opacity pulse — no shimmer/gradient sweep animation.
- **Empty states**: per `DESIGN_SYSTEM.md` — specific, informative copy
  (what will appear here, what action produces data) rendered at
  `text-body`/`text-caption` sizes with a single small neutral icon at most;
  never an oversized illustration.

No bouncing, no elastic/spring easing, no exaggerated scale-on-hover, no
glow. Every transition should feel like it's confirming an action happened,
not entertaining the user.

---

## 13. Anti-AI Visual Checklist

Before any screen is considered complete, evaluate it against every item
below. A "yes" on any item is a defect to fix, not a note to leave for
later.

1. Does this look like a generic shadcn/Tailwind dashboard template?
2. Are there more than one or two rounded "card" surfaces stacked/nested on
   each other?
3. Is any spacing value larger than what's defined in §3 (`section-spacing`
   / `widget-padding` / gutters)?
4. Is any KPI/metric number larger than `text-kpi-value` (22px) without
   being the single, deliberate `text-kpi-value-lg` (28px) exception for
   that screen — or is there more than one such 28px metric on the screen?
5. Is a color (emerald/coral/amber/`accent-cool`) used anywhere it isn't
   communicating a real semantic state (positive/negative/warning/focus/
   selected/active/informational), or does `accent-cool` visually compete
   with the P&L outcome colors?
6. Is the primary UI typeface anything other than Instrument Sans, or is a
   numeric value rendered in a proportional (non-Plex-Mono) font?
7. Is there any gradient, glassmorphism blur, or glow-heavy hover/focus
   effect anywhere?
8. Is an emoji used as a functional icon anywhere in the UI chrome?
9. Do table rows feel airy rather than dense — would a professional trader
   see fewer rows than necessary on a standard screen?
10. Does the screen, viewed at a glance, read as "serious financial
    software" rather than "consumer SaaS landing-page dashboard"?
    (This one flips — the answer must be yes.)
11. Is any border-radius above 8px (`radius-modal`) used anywhere?
12. Are icons decorating every metric/row, rather than appearing only where
    they add real identification value?
13. Is zebra-striping present in any table (it should not be, per §7)?
14. Does any non-outcome metric (e.g. compliance %) borrow P&L color
    semantics, violating the process/outcome separation from `PRODUCT.md`?
15. Is animation duration anywhere noticeably above ~200ms, or does any
    transition use bounce/spring/elastic easing?

This checklist should be re-read, not just referenced from memory, for
every new screen or widget type introduced.

---

## Checkpoint 002 review decisions (resolved)

The following were flagged for human approval and have been decided and
applied throughout this document:

1. **Break-even** — approved as neutral gray (`break-even`), never amber.
   Amber (`warning`) remains scoped to warning/caution semantics only.
2. **Drawdown** — approved three-state semantic ramp: neutral → warning →
   negative.
3. **Cool accent** — broadened from "focus ring only" to a restrained
   `accent-cool` token covering: focus indicator, selected state, active
   navigation state, active filter/tab, and informational semantic state.
   Never decorative, never a blue SaaS theme, never competing visually
   with P&L semantic colors.
4. **Typography ceiling** — default KPI/metric ceiling stays 22px
   (`text-kpi-value`). A new `text-kpi-value-lg` (28px) exists as a rare,
   explicit exception for a single primary metric per major screen/section.
   28px is the hard application-wide ceiling.
5. **Density** — compact density remains fully specified but is not built
   in the first UI scaffold; initial implementation is standard-density
   only. Tokens must stay structured so compact remains addable later
   without rearchitecture.

## Still pending: color palette visual review

Per this checkpoint's review instructions, the exact hex values in §2 have
**not** been changed and are not yet finally locked — they are printed in
full (alongside the typography and geometry scales) in this turn's
end-of-conversation summary for visual sign-off before Checkpoint 002 is
committed.
