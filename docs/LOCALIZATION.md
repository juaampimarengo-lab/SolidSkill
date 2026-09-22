# Solid Skill — Localization

Checkpoint 012C. The localization/i18n foundation: English + Spanish,
selectable at runtime, English default and fallback. This is **not** a full
translation campaign — see "V1 limitations" below for what is intentionally
still English-only.

## Supported languages

Canonical locale identifiers: `en`, `es` (no country variants like `en-US` /
`es-AR` yet). Product-facing names are "English" and "Español" — used as
literal labels, not translation keys, since a language's own name in its own
language does not get translated further.

## Default / fallback behavior

- English (`en`) is both the default language for a first run and the
  fallback for any missing Spanish copy.
- A missing/invalid remembered preference resolves to English — never a
  crash, never blank UI.
- A missing Spanish key resolves to its English text. It never renders as a
  blank string and never renders the raw key (`strategy.rules.helper`).
- Progressive translation is a first-class scenario: a screen can be entirely
  untranslated (English shows everywhere) without breaking anything.

## Terminology philosophy

> Trading language stays trading language. Product guidance adapts to the
> user's language.

Solid Skill is a professional trading application. Canonical trading
vocabulary reads the same to a Spanish-speaking trader as it does in every
other serious trading tool; translating it would make the product feel less
professional, not more accessible. Product guidance, explanations, and UI
chrome are exactly the opposite: they should meet the user in their own
language.

### 1. Never / generally do not translate (canonical trading terminology)

Win Rate, P&L, Long, Short, Trade, Setup, Drawdown, Risk / Reward, R, Entry,
Exit, Stop Loss, Take Profit, Break Even, Journal — and, within the Strategy
Builder specifically: `Rule kind` values (`Required` / `Optional` /
`Conditional`), persisted rule-evaluation states (`PASS` / `FAIL` / `N/A` /
`UNREVIEWED`), and the product's own proper nouns (**Strategy**, **Trade**).

### 2. Product copy — translate

Generic actions (Create, Edit, Delete, Publish, Discard, Save, Cancel,
Retry), structural nouns (Version, Description, Rule, Rule group), status
words (Loading, Error, No data), and — highest priority for this checkpoint —
all Strategy Builder explanatory/guidance prose: draft/publish/discard
messaging, version-history explanations, compliance/review disclaimers,
empty states, confirmation text.

### 3. User data — never translate automatically

Strategy names, Rule names, Rule text, Notes, Account display names,
instrument symbols (e.g. `XAUUSD.x`), broker/platform identifiers, imported
metadata, and any other persisted value a user typed or that came from an
import. None of this is ever routed through a translation function.

This glossary is expected to evolve deliberately as new screens are
translated — but a term's classification should stay consistent once set.

## No domain-model translation

Persisted values are never translated: `LONG` / `SHORT` direction, rule
evaluation states, source platform identifiers, account source types. The
renderer may show localized explanatory text *around* those concepts, but the
canonical value itself (and anything compared against it) is always the
English/domain token. Database schemas and enums are untouched by
localization.

## Architecture

**Library:** [i18next](https://www.i18next.com/) + `react-i18next`. Chosen
over a homegrown string-replacement system because both are mature, small,
and already solve exactly the requirements here — namespaced resources,
built-in `fallbackLng`, safe interpolation, a `Trans` component for sentences
that need embedded styled markup (e.g. a version number) without breaking
word order across languages. No backend plugin is used: resources are
bundled JSON, imported directly, no network calls, no runtime translation
service.

**Resource structure** (`src/renderer/src/i18n/locales/{en,es}/*.json`),
loaded by namespace:

- `common` — generic actions/status words shared across the app
- `shell` — app shell chrome (Settings screen, generic placeholder copy)
- `strategy` — Strategy Builder guidance (the checkpoint's highest-priority
  surface)
- `accounts` — Active Account narrative states (loading/unavailable/empty)

Only what's actually used exists today; `journal`, `calendar`, and `review`
namespaces are not created until a checkpoint actually translates copy in
those screens (see Progressive Adoption below) — no speculative empty
namespaces.

Keys describe meaning, not literal English sentences (`strategy.rules
.empty.noGroups`, not `no_groups_yet_add_a_group`). Sentences that embed a
styled numeric value (a version badge) use `react-i18next`'s `<Trans>`
component with an indexed `components` array so the number's monospace
styling survives translation and word order can differ per locale:

```tsx
<Trans
  i18nKey="publishedBanner"
  t={t}
  values={{ version: version.number }}
  components={[<span key="num" className="num" />]}
/>
```
```json
"publishedBanner": "Published <0>v{{version}}</0> — frozen, read-only. …"
```

## Preference storage

Language is a **presentation preference**, not trading data — same category
as the Active Account choice (`docs/ACTIVE_ACCOUNT.md`). It is stored in the
same `preferences.json` file in the Electron `userData` folder, under a
`language` key next to `activeAccountId`. **No migration was added** — this
never touches SQLite.

Because two independent preferences now share one file, `preferencesFile.ts`
(`src/main/preferences/`) does a read-merge-write on every write, so setting
one preference can never silently erase the other. (`FileActiveAccountStore`
was refactored internally to use this same helper — its public interface is
unchanged.)

Resolution (`SettingsService.getLanguage`): the remembered value if it's
exactly `en` or `es`; otherwise `en`. A missing/unreadable/malformed
preferences file, or an unrecognized stored value, all resolve to English —
never an error, never blank UI.

## IPC

`window.solidSkill.settings` — `getLanguage()` / `setLanguage(language)`,
both returning `{ language: 'en' | 'es' }` through the same `IpcResult`
envelope every other IPC call uses. `setLanguage` validates in the main
process; an unsupported value is `INVALID_INPUT`.

One exception to "every preload method is `invoke`": a single **synchronous**
channel (`settings:getLanguageSync`), called once from the preload script
before any renderer code runs, exposed as the plain value
`window.solidSkill.initialLanguage`. This lets `i18next.init()` be seeded
with the correct language *before the first React render*, so there is no
flash back to English while the async `getLanguage()` call resolves on
reload/restart. It is preload-only — application code always uses the async
`settings` API for anything after startup.

## Runtime switching

Changing the language only updates `i18next`'s active language and
re-renders subscribed components. It never touches SQLite, never changes the
active account, never resets the current route/Draft/selection, and never
writes a Trade fact. The `useLanguage` hook mirrors `useAccounts`: optimistic
update, background persistence, and a latest-wins gate so a rapid double
switch can't leave state on a stale value.

## Language control

A restrained "Language: English / Español" segmented control on a minimal new
Settings screen (`src/renderer/src/components/settings/SettingsWorkspace.tsx`)
— the Sidebar already had an unimplemented "Settings" nav entry (previously
rendering the generic `Placeholder`). No Settings redesign, no flags, no
gradients, no oversized pills — one row using the existing design tokens.

## Progressive adoption

From this checkpoint on, new user-facing product prose should be added as a
translation key (in the right namespace) rather than a hardcoded English
string, with an English value at minimum. Spanish can be added in the same
change or a follow-up — a missing Spanish key is always safe (falls back to
English). Developer-only strings (console logs, dev-tooling QA output) are
never localized.

## Adding a new language later

1. Add the locale code to `LANGUAGES` in `src/shared/ipc/settings.ts` (keep
   it a bare code like `pt`, not a country variant, unless the product later
   needs region-specific formatting).
2. Add `src/renderer/src/i18n/locales/<code>/*.json` for every namespace that
   exists, translating the English source. A partially-translated new
   language works immediately — missing keys fall back to English.
3. Register the resource bundle in `src/renderer/src/i18n/index.ts`.
4. Add the display name to `LANGUAGE_NAMES` in `SettingsWorkspace.tsx`.
5. No migration, no schema change, no IPC contract change beyond the widened
   `Language` union.

## Known V1 limitations

- Only Strategy Builder guidance, the Settings screen, generic shell
  states (loading/error/empty), and Active Account narrative states are
  translated. Journal, Calendar, Dashboard, Analytics, Weekly Review,
  Accounts, Integrations remain English-only until a later checkpoint
  translates them.
- Strategy Builder table headers/columns (Versions tab, Trades tab) and the
  `publishBlocker` advisory messages from `shared/strategyRules.ts` are not
  yet routed through i18next — lower priority than the guidance prose this
  checkpoint targeted.
- Number/date/currency formatting is intentionally unchanged by language —
  `217.66` does not become `217,66` when Spanish is selected. Locale-aware
  formatting, if ever wanted, is a deliberate future decision, not a side
  effect of this checkpoint.
- No Portuguese or other languages yet; no online/AI translation; no
  region-specific locales (`es-AR`, etc.).
