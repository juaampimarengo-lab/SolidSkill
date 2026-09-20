# Solid Skill — IPC Contract

Checkpoint 011B-1. How the renderer reaches persisted data. Persistence
itself is described in `PERSISTENCE.md` and `DATABASE_SCHEMA.md`.

```
Renderer ─▶ window.solidSkill (preload) ─▶ typed IPC ─▶ handlers (validate)
        ─▶ StrategyService ─▶ repositories ─▶ SQLite        (all in main)
```

## 1. Renderer trust boundary

The renderer is untrusted UI code. It never imports `node:sqlite`, the
database module, repository classes, SQL, or `ipcMain`, and it has no
`require`, `process`, or raw `ipcRenderer` (verified at runtime by
`npm run qa:strategies-restart`). Everything it sends is treated as
`unknown` until validated in the main process. Anything it receives is plain
application data.

## 2. Preload role

`src/preload/index.ts` is the only bridge. Through `contextBridge` it exposes
exactly one object, `window.solidSkill`, whose methods each invoke one fixed
channel. It exposes no generic `send`/`invoke`, no channel names, no
filesystem, no process, no SQL. The type of the object is
`SolidSkillApi` in `src/shared/ipc/strategies.ts`, declared globally in
`src/preload/index.d.ts`.

## 3. Strategy operations

All return `Promise<IpcResult<…>>`. Mutations return the resulting Strategy
aggregate so the renderer reconciles with what was actually persisted.

| Method | Effect |
|---|---|
| `list()` | every strategy (active + archived) with published versions (oldest first) and its optional Draft |
| `create({name, description})` | Strategy + initial empty Draft in one transaction; **no version** until first publish |
| `updateDetails({strategyId, name, description})` | metadata only; never creates a Draft or Version |
| `archive(id)` / `restore(id)` | lifecycle flag; history untouched. Archive requires ≥1 published version and no open Draft; idempotent |
| `deleteUnpublished(id)` | permanent delete, only for a never-published strategy |
| `beginDraft(id)` | Draft copied from the current published version (one Draft per strategy) |
| `discardDraft(id)` | removes only the Draft; requires a published version to return to |
| `editDraft({strategyId, edit})` | one intent-level edit: `addGroup`, `renameGroup`, `deleteGroup`, `moveGroup`, `addRule`, `updateRule`, `deleteRule`, `moveRule` |
| `publishDraft(id)` | validates, then makes the next sequential immutable version, in one transaction |

Rules enforced in main regardless of what the UI does: archived strategies are
read-only; group/rule ids are honoured only if they belong to *this*
strategy's Draft; names are unique case-insensitively; publish requires ≥1
rule, no empty/unnamed groups, and a change from the base version (the same
shared function the UI uses: `src/shared/strategyRules.ts`). Published
versions stay immutable at the repository *and* schema level.

## 4. Error / result shape

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code; message } }
code: PERSISTENCE_UNAVAILABLE | INVALID_INPUT | NOT_FOUND | CONFLICT | RULE_VIOLATION | INTERNAL
```

The renderer never receives a thrown exception. `PERSISTENCE_UNAVAILABLE`
means the database failed to open at startup: the UI shows an error state,
**never** fixtures or an empty list. `INTERNAL` carries a generic message;
details are logged in main only.

## 5. Serialization rules

- Only JSON-serializable values cross: strings, numbers, booleans, null,
  arrays, plain objects. No `BigInt`, `Date`, class instances, functions, or
  `Map`/`Set`.
- Timestamps are epoch milliseconds (`publishedAt`); formatting is the
  renderer's job.
- Persistence rows (upper-case enums, fixed-point integers) never cross.
  Handlers return DTOs (`StrategyDto` …). Money/price/quantity, when
  Trades arrive, cross as decimal strings (see `DATABASE_SCHEMA.md` §13).
- IDs are opaque strings. Persisted IDs — not names — identify strategies,
  groups and rules.
- Payloads are validated with bounds (`src/main/ipc/validation.ts`); unknown
  edit types, wrong types, oversized text → `INVALID_INPUT`.

## 6. Why raw SQL / DB access is prohibited

A `query(sql)` or exposed connection would let any renderer bug (or injected
content) rewrite or delete history, bypass the immutability rules
(`CLAUDE.md` Absolute Rule 3), and would couple UI code to the schema so every
migration becomes a UI change. Application-level operations keep every
invariant in one place (service + schema triggers), keep the UI independent of
storage, and keep the trust boundary auditable: the entire renderer-reachable
surface is the table in §3.

## 7. Future extension (Trades, Accounts)

Add new namespaces to `SolidSkillApi` (`trades`, `accounts`) with their own
DTOs, channel constants, validators, and service, following the same pattern:
shared DTO + channel names in `src/shared/ipc/`, validation + handlers in
`src/main/ipc/`, a service over the repositories, one line per method in the
preload. Trade DTOs carry money as decimal strings and associate strategies
by persisted Strategy/Version ids. Nothing is generic; every operation is
named and reviewed.
