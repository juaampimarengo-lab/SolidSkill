# Solid Skill — Trade Media (Chart Evidence)

Checkpoint 014. Multiple chart screenshots/images can be attached to a Trade
or to a trading Day, each carrying a timeframe, a stage, an optional caption,
and a created timestamp. This document is the source of truth for the
storage architecture, schema, upload/capture flows, security model, and known
limitations. It does not cover Tradovate connectivity (explicitly postponed;
untouched by this checkpoint).

## 1. Purpose

Chart Evidence lets a trader attach the visual context behind a Trade or a
trading day — higher-timeframe structure, the setup, the entry confirmation,
the result — without collapsing that into a single screenshot field. A Trade
commonly needs several images across different timeframes and stages (e.g.
4H pre-trade context, 15m setup, 5m entry confirmation, 5m post-trade
result); a trading Day needs its own images (session plan, end-of-day
result) that are not really about any one Trade.

## 2. Trade vs Day media

Two distinct ownership shapes, both stored in one table, never conflated:

- **Trade media** — belongs to exactly one Trade (`trade_id`). Shown in Trade
  Review's Charts tab.
- **Day media** — belongs to one (account, analytical date) pair
  (`account_id` + `analytical_date`), independent of any single Trade on that
  day. Shown in Day Review.

A schema `CHECK` enforces that a row is exactly one of these shapes (see §4).
There is no third ownership kind and no cross-linking between a Trade image
and its day.

## 3. Storage architecture

Metadata lives in SQLite; image bytes live as files under the Electron
`userData` folder, never as a database BLOB:

```
userData/
  solid-skill.db
  media/
    trades/
      <tradeId>/
        <mediaId>.<ext>
    days/
      <accountId>/
        <YYYY-MM-DD>/
          <mediaId>.<ext>
```

`managed_path` in the database is a path **relative to `userData/media/`**
(e.g. `trades/<tradeId>/<mediaId>.png`), never absolute and never derived
from user input — both the directory and the filename are built from opaque,
Solid-Skill-generated ids (`src/main/media/mediaStorage.ts`). This also
satisfies the "prefer portable managed relative paths" guidance for a future
backup/export feature (§13).

`MediaStorage` (`src/main/media/mediaStorage.ts`) owns this tree: it writes
files, and every read/delete re-resolves the path and verifies it stays
inside the media root before touching disk — the same guard runs for a
normal delete and for a defensive check against a corrupted row, so a
malformed `managed_path` can never be used to reach outside `media/`.

## 4. Migration / schema

Migration 003 (`003_trade_media.ts`, `src/main/persistence/migrations/`)
adds one table, `trade_media`, and is additive-only — migrations 001 and 002
are untouched, per `CLAUDE.md`'s append-only migration rule.

```
trade_media
  id               TEXT PRIMARY KEY
  owner_type       TEXT  CHECK (TRADE | DAY)
  trade_id         TEXT  REFERENCES trades(id)          -- set only for TRADE
  account_id       TEXT  NOT NULL REFERENCES accounts(id)
  analytical_date  TEXT  'YYYY-MM-DD'                    -- set only for DAY
  managed_path     TEXT  NOT NULL                        -- relative to media root
  format           TEXT  CHECK (PNG | JPEG | WEBP)
  timeframe        TEXT  CHECK (M1|M3|M5|M15|M30|H1|H2|H4|D1|W1|OTHER)
  stage            TEXT  CHECK (PRE_TRADE|ENTRY|MANAGEMENT|EXIT|POST_TRADE)
  caption          TEXT  NULLABLE
  is_featured      INTEGER NOT NULL DEFAULT 0 CHECK (0|1)  -- Trade-only; see §12b
  created_at       INTEGER NOT NULL
```

A `CHECK` constraint ties `owner_type` to which of `trade_id` /
`analytical_date` is set (exactly one, never both, never neither). A second
`CHECK` forbids a Day row from ever being featured. A composite foreign key
`(trade_id, account_id) REFERENCES trades (id, account_id)` proves a Trade
image's account matches the Trade's own account. A partial `UNIQUE` index
enforces at most one featured row per Trade. Indexes support the two list
queries: `(trade_id, created_at)` and `(account_id, analytical_date,
created_at)`.

Rows are **immutable once written**, with one exception — a trigger blocks
`UPDATE` of every column except `is_featured` (§12b); everything else is
insert and delete only. Changing a caption or reclassifying an image is a
delete + re-add, matching the "no editing UI yet" posture used elsewhere in
the app rather than adding an edit surface for V1.

## 5. Timeframe model

Timeframe belongs to the **image**, not the Trade — several images of the
same Trade can each carry a different timeframe. V1 offers a fixed,
extensible enum (`M1, M3, M5, M15, M30, H1, H2, H4, D1, W1, OTHER`); adding a
new one is a small, additive change (new CHECK value + i18n label), not a
schema rewrite. Timeframe values are canonical trading vocabulary, following
`docs/LOCALIZATION.md` — they are never translated (the renderer's
`timeframeLabel()` in `src/renderer/src/lib/media.ts` maps them to `1m`,
`5m`, `4H`, `Daily`, etc., independent of the active language). `OTHER` is
the one exception: it is product chrome, not a trading term, and is
translated.

## 6. Stage model

Canonical persisted values: `PRE_TRADE, ENTRY, MANAGEMENT, EXIT, POST_TRADE`.
These are stored exactly as-is and rendered through i18n (`journal.stage.*`
keys, EN/ES) — the database never stores a localized label, matching the
Rule-kind/evaluation-state pattern already used for Strategy data.

## 7. Upload (disk image)

`window.solidSkill.media.pickImageFile()` opens a native `dialog.showOpenDialog`
scoped to `.png/.jpg/.jpeg/.webp`, entirely in the main process
(`src/main/ipc/registerMediaIpc.ts`). The renderer never sees the chosen
path: main reads the file itself, validates its real format by magic bytes
(`detectImageFormat`, §9), and stages the validated buffer in memory behind a
short-lived opaque token (`MediaService.stage`, 5-minute TTL). The renderer
receives only `{ token, format, previewDataUrl }` — enough to preview before
Save. Save (`addTradeMedia` / `addDayMedia`) consumes the token, copies the
bytes into managed storage, and writes the metadata row in one transaction;
if the metadata write fails, the just-written file is removed so nothing
orphaned is left behind.

The original file's path is used exactly once, inside that single main-process
call, and is never stored, logged to the renderer, or reused — "never
permanently reference the user's original file path" is satisfied by
construction, not by convention.

## 8. Capture (screen/window)

Investigated first, as instructed: Electron's `desktopCapturer` API. V1
implementation:

1. `media.listCaptureSources()` (main, `desktopCapturer.getSources({ types:
   ['screen', 'window'] })`) returns every screen and window with a thumbnail,
   rendered in Solid Skill's own compact picker grid
   (`AddChartModal`/`sourcesBody`) — there is no OS-native "pick a window"
   dialog exposed by desktopCapturer, so Solid Skill draws its own.
2. The renderer calls `navigator.mediaDevices.getUserMedia` with the chosen
   source's id (`chromeMediaSource: 'desktop'`, the documented Electron
   pattern for desktopCapturer-backed streams), draws exactly one frame to a
   canvas, and immediately stops the stream — Solid Skill only ever needs a
   still image, never a recording (`docs` Non-goals: no video recording).
3. An optional crop step lets the user drag a rectangle over the captured
   frame; "Use full capture" skips cropping. The cropped (or full) frame is
   exported as PNG and sent to `media.stageCapturedImage(bytes)`, which
   validates it exactly like an uploaded file and returns the same
   `{ token, previewDataUrl }` shape — the rest of the Add Chart flow
   (Timeframe / Stage / Caption / Save) is identical for both sources.

**Exact V1 capability** (see also §14 "Capture QA"): **screen and window
selection**, plus an **in-app optional crop** — i.e. exactly the documented
fallback ("if robust OS-level region capture requires too much custom native
work, implement screen/window selection + optional crop inside Solid
Skill"). This is *not* an OS-level region-capture tool; the crop happens
after a full-source frame is captured, inside Solid Skill's own canvas.
Multi-monitor: each physical screen desktopCapturer reports is a separate,
individually selectable source, so capturing a specific monitor is a normal
source pick, not a special case.

## 9. File format validation

`detectImageFormat` / `validateImageBuffer`
(`src/main/media/mediaStorage.ts`) decide format **only from magic bytes**,
never from a file extension or a client-declared MIME type:

- PNG: `89 50 4E 47 0D 0A 1A 0A`
- JPEG: `FF D8 FF`
- WebP: `RIFF....WEBP`

Anything else — including SVG, GIF, BMP, an executable, or HTML disguised
with an image extension — is rejected before a single byte is written to
disk or a database row is created. There is a 15 MB size ceiling (a generous
screenshot bound, not a product setting).

## 10. Normalization / compression policy

**None in V1.** The validated bytes are stored exactly as received — no
re-encoding, no forced conversion to WebP, no downscaling. The checkpoint's
conceptual layout used a `.webp` extension for every stored file; Solid
Skill instead keeps each image's own validated format/extension
(`.png`/`.jpg`/`.webp`) because no image-processing dependency (e.g. `sharp`)
is currently part of the project, and adding a new native/binary dependency
for this checkpoint was avoided rather than done implicitly. This is called
out explicitly as a V1 limitation (§16), not silently deviated from.

## 11. Security

- **No unrestricted filesystem API in the renderer.** The entire
  renderer-reachable surface is the eight named `media:*` channels
  (`src/shared/ipc/media.ts`); there is no `readFile`, `writeFile`, or path
  parameter anywhere in that surface. `pickImageFile` and
  `listCaptureSources` are the only two channels that touch Electron-native
  APIs, and both are wired directly in `registerMediaIpc.ts` — never in the
  renderer.
- **No path traversal.** `MediaStorage.resolveManaged` re-resolves every
  stored relative path against the media root and refuses (returns `null`)
  anything that would escape it; both reads (the `ssmedia://` protocol, §12)
  and deletes go through this guard.
- **No arbitrary file deletion.** Deletion only ever unlinks the exact
  `managed_path` value of a `trade_media` row that existed in the database,
  re-validated by the same traversal guard — there is no delete-by-path
  operation reachable from the renderer at all.
- **No remote URL fetching.** Upload and capture are both local-only; no
  network request is made to obtain an image.
- **No SVG, no executable formats, no HTML-as-image tricks.** The magic-byte
  allowlist (§9) is exhaustive — nothing outside PNG/JPEG/WebP is ever
  accepted, regardless of extension.
- **Reading an image is not IPC.** The renderer displays images via
  `ssmedia://<mediaId>` (§12), a read-only custom protocol scoped to rows
  that exist in the database — never a `file://` URL, and never a filesystem
  path exposed to the DOM.

## 12. The `ssmedia://` protocol

Registered in `src/main/media/protocol.ts`, as a privileged, non-standard,
secure scheme (`protocol.registerSchemesAsPrivileged`, called before
`app.whenReady()`) so it behaves like a normal image origin (`<img
src="ssmedia://<id>">`) without granting filesystem or Node access to the
page. The handler (`protocol.handle`, registered after the persistence layer
is ready) looks up `<id>` in the `trade_media` table, re-validates the
managed path stays inside the media root, and serves the file with the
correct content type — a 404 for any unknown id, any id whose database row's
path escapes the root, or while the database is unavailable. This is the
entire "filesystem access" the renderer receives: read-only, and only for
rows Solid Skill itself wrote. The handler reads the managed file directly
with `MediaStorage.read()` (a plain `readFileSync` re-validated against the
media root) and returns it as the `Response` body — no `file://` URL is ever
constructed, even internally (see §12a).

### 12a. Checkpoint 014 rendering bug — root cause and fix

Manual QA found that upload and capture both persisted correct metadata (the
Charts gallery listed the right timeframe/stage/caption for each item) but
every chart image itself rendered as a broken/missing image, in both the
gallery thumbnail and the full preview.

**Root cause:** `src/renderer/index.html`'s Content-Security-Policy declared
`img-src 'self' data:` — it never allowed the `ssmedia:` scheme. Every
`<img src="ssmedia://<id>">` was silently blocked by CSP before the browser
ever reached the protocol handler; the handler, the file writes, and the
metadata were all correct and were never the problem. This is why the bug
was consistent across both Upload and Capture (both produce an
`ssmedia://` URL) and both the gallery and the full preview (both use the
same `<img>` mechanism).

**Fix:** `img-src` now includes `ssmedia:` (`'self' data: ssmedia:`). While
investigating, the protocol handler was also simplified from
`net.fetch(pathToFileURL(...))` to a direct `MediaStorage.read()` call — one
fewer URL-construction/encoding surface on Windows paths, still fully scoped
by the same path-traversal guard, and never touching `file://` even as an
implementation detail.

**Regression coverage:** `smoke:trade-media` gained direct `MediaStorage.read`
byte-serving checks (main-process layer). Because the CSP bug specifically
required a real Chromium renderer with the real CSP header to reproduce — a
headless Node smoke test cannot see it — `npm run qa:trade-media`
(`scripts/trade-media-qa.mjs`) was added: it drives the real built app over
CDP, stages a synthetic PNG through the real IPC surface, and asserts the
resulting `<img>` actually decodes (`naturalWidth`/`naturalHeight > 0`) in
the Journal quick-preview gallery, the full-preview lightbox, the Trade
Review Overview panel, and Day Review — the exact bug this checkpoint fixes,
reproduced and asserted against directly.

## 12b. Featured chart (Overview)

Trade media only (never Day media) can carry one **featured** item — the
image shown prominently in Trade Review's Overview, in place of the
illustrative Execution Visualization, so a trader can recognize a Trade at a
glance without opening the Charts tab.

**Schema.** `trade_media.is_featured` (migration 003 — see §4; the column
was added to that same migration because 003 had not yet been committed when
the need appeared, per `CLAUDE.md`'s append-only rule only binding on
*committed* migrations). A `CHECK` forbids a Day row from ever being
featured (`owner_type = 'TRADE' OR is_featured = 0`), and a partial `UNIQUE`
index (`... WHERE is_featured = 1`) enforces at most one featured row per
Trade at the database level, not just in application code.

Rows are otherwise immutable (§4's no-update trigger), but `is_featured`
specifically is not — the trigger is scoped with `BEFORE UPDATE OF <other
columns>`, so an `UPDATE ... SET is_featured = ...` does not fire it. This is
the one exception to "delete and re-add" in the whole table.

**Invariant.** Whenever a Trade has at least one media item, exactly one of
them is featured — maintained entirely by `MediaService`, never left for the
renderer to infer:

- **First image attached to a Trade** → featured automatically
  (`MediaService.addTradeMedia`, checked inside the same transaction as the
  insert).
- **User picks a different image** → `setFeaturedTradeMedia(tradeId,
  mediaId)` (IPC channel `media:setFeaturedTradeMedia`) atomically unsets the
  previous featured row and sets the chosen one, inside one transaction.
- **The featured image is deleted** → `MediaService.delete` promotes the
  newest remaining Trade image (`created_at DESC, id DESC`) in the same
  transaction as the delete, so a Trade with media never silently ends up
  with none featured. Deleting a non-featured image never disturbs the
  featured one.
- **The last image is deleted** → no promotion candidate exists; the Trade
  simply has no media and no featured item (Overview falls back to the
  illustrative Execution Visualization, §12c).

No timeframe is ever used to auto-select a featured image — Solid Skill
stays methodology-agnostic (`CLAUDE.md` rule 2); the choice is always
either "first image" or an explicit user action.

**UI.** Each Charts gallery tile (`ChartGallery.tsx`) shows a small star
control ("Set as Overview" filled, or "Featured chart" once set), present
only where a Trade context passes an `onSetFeatured` handler — Day media's
`ChartGallery` usage never receives it, so no star renders there. Trade
Review's Overview panel (`TradeReviewWorkspace.tsx`) and the Charts tab
gallery share **one** `useTradeMedia` fetch/refresh (not two independent
ones) so that setting a new featured image is reflected in Overview
immediately, without a remount.

## 12c. Overview behavior

Trade Review's main visualization block shows:

- **Chart Evidence exists** (the Trade has a featured item) → the real
  featured chart image, at a useful size, with its timeframe/stage line,
  clickable to the full-size `ChartLightbox` preview. A restrained
  thumbnail strip appears when the Trade has more than one image, letting
  the trader switch which one is *displayed* in this panel without changing
  which one is *featured* (a local-only selection, not persisted).
- **No Chart Evidence** (no media, or none featured) → the existing
  illustrative Execution Visualization (`TradeChart`) — unchanged,
  preserved exactly as before this checkpoint.

## 12d. Full preview

`ChartLightbox.tsx` (shared by the Charts gallery and the Overview panel —
extracted from ChartGallery's inline modal during this checkpoint) shows the
real image at up to 1100px/92vw, aspect ratio preserved
(`object-fit: contain`, never cropped or upscaled beyond its own
resolution), with the timeframe/stage line and caption. Closes on the X
button, Escape, or a click outside the image panel.

## 13. Deletion consistency

`MediaService.delete` (`src/main/media/mediaService.ts`) deletes the
database row first, then best-effort removes the managed file
(`MediaStorage.deleteIfManaged`, which never throws on a missing file). If
the file is already gone — manual interference, a prior partial failure —
deletion still succeeds from the app's point of view: the metadata is gone,
which is the user-visible contract ("this chart is no longer attached").
This is a deliberate choice for partial failure: a missing on-disk file must
never block removing an app-visible attachment, and a database delete is
never skipped because a file operation might fail.

## 14. Real Trade safety

Media is additive journal data. Nothing in this checkpoint (including the
CSP fix and the featured-chart addition) touches `trades`, `executions`,
direction, P&L, timestamps, strategy version associations, or rule
evaluations — the only writes are inserts/deletes on `trade_media` and, for
the featured flag specifically, the one narrowly-scoped `is_featured`
update carved out of the immutability trigger (§12b). `trade-media-smoke`
includes a restart-persistence check that reopens the database and confirms
the attached image and its metadata are unchanged; `qa:trade-media` drives
the real app end-to-end and never touches real trading facts either (fresh,
throwaway `userData` per run, development seed data only).

## 15. Localization

New namespace `journal` (`src/renderer/src/i18n/locales/{en,es}/journal.json`),
registered in `src/renderer/src/i18n/index.ts`. Translated: "Chart
Evidence", "Add Chart", "Capture Screen", "Upload Image", "Timeframe",
"Stage", "Caption", the five stage labels, "No charts attached yet",
"Delete", "Cancel", "Save", the capture-flow copy (source picker, crop), and
(this checkpoint) "Show in Overview" / "Featured chart" for the star
control. Never translated: timeframe values (M1…W1, canonical trading
vocabulary — see §5), user-entered captions, symbols, account names, and any
other user/import data. `smoke:i18n` checks EN/ES key parity for the
namespace the same way it already does for `common` / `shell` / `strategy` /
`accounts`.

## 16. Known V1 limitations / future improvements

- **No image re-encoding/compression** (§10) — files are stored as
  uploaded/captured, in their original validated format.
- **No OS-level region capture** — only screen/window selection plus an
  in-app crop (§8); a true OS region picker was not implemented, per the
  explicit "do not claim region capture if it is not actually implemented"
  instruction.
- **No screenshot annotation/drawing tools** — explicit non-goal this
  checkpoint.
- **No caption/timeframe/stage editing** — delete and re-add only (§4);
  `is_featured` is the one deliberate exception (§12b).
- **No thumbnail cache** — each gallery tile is a direct `ssmedia://` image
  request; fine at V1 scale, worth revisiting if a Trade routinely carries
  many large images.
- **`qa:trade-media` stages synthetic images through the IPC surface, not
  the native file dialog or `desktopCapturer`** — those two channels need
  real OS-level interaction (a native file picker, a screen-capture
  permission prompt) that a scripted CDP harness cannot drive; they were
  exercised manually, same as the original checkpoint. Everything
  downstream of staging (storage, the `ssmedia://` protocol, rendering,
  featured-chart behavior, Overview, Day Review) is covered by
  `qa:trade-media` against the real built app.

## 17. Backup / export (future)

Not implemented this checkpoint (`PERSISTENCE.md` §11 already defers
backup/export generally). When it is built, it must copy **both**
`solid-skill.db` and `media/` — an export of one without the other leaves
either orphaned files or metadata rows pointing at nothing. `managed_path`
being relative to `media/` (§3) means the whole `media/` folder can move
alongside the database file without rewriting any row.
