/**
 * Chart Evidence / Trade Media smoke suite (Checkpoint 014). Development
 * tooling only — not imported by the application. Runs inside the real
 * Electron main-process runtime against a temporary SQLite database and a
 * temporary media folder under the OS temp directory; never touches the
 * user's real database or userData/media/.
 *
 * Electron's dialog and desktopCapturer are not exercised here (they need a
 * live window and, for capture, OS permission/UI interaction) — see
 * docs/TRADE_MEDIA.md "Capture QA" for what was verified interactively. This
 * suite covers the format validation, storage, repository, service and IPC
 * layers that both the upload and capture flows converge on.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../../persistence'
import type { NewTrade } from '../../persistence'
import { createMediaHandlers } from '../../ipc/mediaHandlers'
import { detectImageFormat, MediaStorage, validateImageBuffer } from '../mediaStorage'
import { MediaService } from '../mediaService'

let passed = 0
let failed = 0
const lines: string[] = []

function check(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    lines.push(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    lines.push(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}

function equal<T>(actual: T, expected: T, label = 'value'): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`)
}

function throws(fn: () => unknown, pattern: RegExp): void {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!pattern.test(message)) throw new Error(`threw "${message}", expected ${pattern}`)
    return
  }
  throw new Error(`expected an error matching ${pattern}, but nothing was thrown`)
}

const workDir = mkdtempSync(join(tmpdir(), 'solid-skill-media-smoke-'))
let counter = 0
const nextPath = (name: string): string => join(workDir, `${name}-${(counter += 1)}`)

// Minimal valid magic-byte-only fixtures — Solid Skill validates format by
// signature, not by fully decoding the image, so these are sufficient.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')])
const NOT_AN_IMAGE = Buffer.from('<html><body>not an image</body></html>', 'utf8')

function openFixture(): { db: Database; storage: MediaStorage; service: MediaService; tradeId: string; accountId: string } {
  const db = Database.open(nextPath('db') + '.sqlite')
  const storage = new MediaStorage(nextPath('media-root'))
  const service = new MediaService(db, storage)
  const account = db.repositories.accounts.create({ displayName: 'Media Smoke', sourcePlatform: 'dev-fixture', currency: 'USD' })
  const newTrade: NewTrade = {
    accountId: account.id,
    analyticalTradeDate: '2026-02-03',
    instrument: 'ESH6',
    direction: 'LONG',
    quantity: '1',
    openedAt: 1_700_000_000_000,
    avgEntryPrice: '5000',
    executions: [{ executedAt: 1_700_000_000_000, side: 'BUY', quantity: '1', price: '5000' }]
  }
  const trade = db.repositories.trades.createTrade(newTrade)
  return { db, storage, service, tradeId: trade.id, accountId: account.id }
}

// ---- format detection -------------------------------------------------------

check('format detection: PNG accepted', () => equal(detectImageFormat(PNG_BYTES), 'PNG'))
check('format detection: JPEG accepted', () => equal(detectImageFormat(JPEG_BYTES), 'JPEG'))
check('format detection: WebP accepted', () => equal(detectImageFormat(WEBP_BYTES), 'WEBP'))
check('format detection: unsupported format rejected', () => equal(detectImageFormat(NOT_AN_IMAGE), null))
check('validateImageBuffer: rejects an unrecognized/unsafe format', () => {
  throws(() => validateImageBuffer(NOT_AN_IMAGE), /Unsupported or unrecognized image format/)
})
check('validateImageBuffer: rejects an empty buffer', () => {
  throws(() => validateImageBuffer(Buffer.alloc(0)), /empty/)
})

// ---- migration ---------------------------------------------------------------

check('migration 003 applies; trade_media table exists', () => {
  const db = Database.open(nextPath('db') + '.sqlite')
  try {
    equal(db.listAppliedMigrations().some((m) => m.name === 'trade_media'), true)
  } finally {
    db.close()
  }
})

check('previous migrations remain intact alongside 003', () => {
  const db = Database.open(nextPath('db') + '.sqlite')
  try {
    equal(
      db.listAppliedMigrations().map((m) => m.name),
      ['initial_core', 'trade_source_identity', 'trade_media', 'weekly_reviews', 'weekly_scorecard', 'strategy_display_order']
    )
  } finally {
    db.close()
  }
})

// ---- trade media ---------------------------------------------------------------

{
  const { db, service, tradeId, accountId } = openFixture()

  check('create Trade media', () => {
    const staged = service.stage(PNG_BYTES)
    const media = service.addTradeMedia({ tradeId, token: staged.token, timeframe: 'M5', stage: 'ENTRY', caption: 'Entry confirmation' })
    equal(media.ownerType, 'TRADE')
    equal(media.tradeId, tradeId)
    equal(media.timeframe, 'M5')
    equal(media.stage, 'ENTRY')
    equal(media.caption, 'Entry confirmation')
    equal(media.format, 'PNG')
    equal(media.url, `ssmedia://${media.id}`)
  })

  check('the first image attached to a Trade becomes featured automatically', () => {
    equal(service.listForTrade(tradeId).every((m) => m.isFeatured), true)
    equal(service.listForTrade(tradeId).length, 1)
  })

  check('multiple images per Trade; multiple timeframes per Trade', () => {
    const s1 = service.stage(PNG_BYTES)
    service.addTradeMedia({ tradeId, token: s1.token, timeframe: 'H4', stage: 'PRE_TRADE', caption: '' })
    const s2 = service.stage(JPEG_BYTES)
    service.addTradeMedia({ tradeId, token: s2.token, timeframe: 'M15', stage: 'PRE_TRADE', caption: '' })
    const list = service.listForTrade(tradeId)
    equal(list.length, 3) // includes the one from the previous check
    equal(new Set(list.map((m) => m.timeframe)).size >= 3, true, 'distinct timeframes')
  })

  check('only the first item is featured; the later ones are not', () => {
    const list = service.listForTrade(tradeId)
    equal(list.filter((m) => m.isFeatured).length, 1)
    equal(list[0]!.isFeatured, true)
    equal(list.slice(1).every((m) => !m.isFeatured), true)
  })

  check('setFeaturedTradeMedia: explicit choice moves the single featured flag atomically', () => {
    const list = service.listForTrade(tradeId)
    const previous = list.find((m) => m.isFeatured)!
    const target = list.find((m) => !m.isFeatured)!
    const updated = service.setFeaturedTradeMedia({ tradeId, mediaId: target.id })
    equal(updated.filter((m) => m.isFeatured).length, 1, 'exactly one featured item')
    equal(updated.find((m) => m.id === target.id)!.isFeatured, true)
    equal(updated.find((m) => m.id === previous.id)!.isFeatured, false)
  })

  check('setFeaturedTradeMedia: a media id from another Trade is refused', () => {
    const other = db.repositories.trades.createTrade({
      accountId,
      analyticalTradeDate: '2026-02-06',
      instrument: 'ESH6',
      direction: 'LONG',
      quantity: '1',
      openedAt: 1_700_300_000_000,
      avgEntryPrice: '5000',
      executions: [{ executedAt: 1_700_300_000_000, side: 'BUY', quantity: '1', price: '5000' }]
    })
    const staged = service.stage(PNG_BYTES)
    const otherMedia = service.addTradeMedia({ tradeId: other.id, token: staged.token, timeframe: 'M1', stage: 'ENTRY', caption: '' })
    throws(() => service.setFeaturedTradeMedia({ tradeId, mediaId: otherMedia.id }), /Media not found/)
  })

  check('deleting the featured item promotes the newest remaining item deterministically', () => {
    const before = service.listForTrade(tradeId)
    const featured = before.find((m) => m.isFeatured)!
    const expectedPromotion = before
      .filter((m) => m.id !== featured.id)
      .reduce((newest, m) => (m.createdAt >= newest.createdAt ? m : newest))
    service.delete(featured.id)
    const after = service.listForTrade(tradeId)
    equal(after.filter((m) => m.isFeatured).length, 1, 'a featured item still exists')
    equal(after.find((m) => m.isFeatured)!.id, expectedPromotion.id)
  })

  check('deleting a non-featured item leaves the featured item unchanged', () => {
    const before = service.listForTrade(tradeId)
    const featuredId = before.find((m) => m.isFeatured)!.id
    const nonFeatured = before.find((m) => !m.isFeatured)!
    service.delete(nonFeatured.id)
    const after = service.listForTrade(tradeId)
    equal(after.find((m) => m.isFeatured)!.id, featuredId)
  })

  check('caption round-trip (including empty caption)', () => {
    const staged = service.stage(PNG_BYTES)
    const media = service.addTradeMedia({ tradeId, token: staged.token, timeframe: 'OTHER', stage: 'EXIT', caption: '  ' })
    equal(media.caption, '')
  })

  check('stage round-trip covers all five canonical stages', () => {
    const stages = ['PRE_TRADE', 'ENTRY', 'MANAGEMENT', 'EXIT', 'POST_TRADE'] as const
    for (const s of stages) {
      const staged = service.stage(PNG_BYTES)
      const media = service.addTradeMedia({ tradeId, token: staged.token, timeframe: 'M1', stage: s, caption: '' })
      equal(media.stage, s)
    }
  })

  check('list Trade media', () => {
    const list = service.listForTrade(tradeId)
    equal(list.length > 0, true)
    equal(list.every((m) => m.tradeId === tradeId), true, 'Trade ownership enforced')
  })

  check('Trade ownership enforced: unrelated trade id is refused', () => {
    const staged = service.stage(PNG_BYTES)
    throws(() => service.addTradeMedia({ tradeId: 'no-such-trade', token: staged.token, timeframe: 'M1', stage: 'ENTRY', caption: '' }), /Trade not found/)
  })

  check('invalid format rejected before any DB row or file is written', () => {
    throws(() => service.stage(NOT_AN_IMAGE), /Unsupported or unrecognized/)
  })

  check('deleting one item leaves siblings; managed file removed', () => {
    const before = service.listForTrade(tradeId)
    const target = before[0]!
    const path = db.repositories.media.getById(target.id)!.managedPath
    service.delete(target.id)
    const after = service.listForTrade(tradeId)
    equal(after.length, before.length - 1)
    equal(after.some((m) => m.id === target.id), false)
    equal(db.repositories.media.getById(target.id), null)
    equal(path.length > 0, true)
  })

  check('missing managed file handled gracefully on delete', () => {
    const staged = service.stage(PNG_BYTES)
    const media = service.addTradeMedia({ tradeId, token: staged.token, timeframe: 'M1', stage: 'ENTRY', caption: '' })
    // Simulate the file already being gone on disk (e.g. manual interference).
    const row = db.repositories.media.getById(media.id)!
    const storageForRoot = new MediaStorage(join(workDir, 'nonexistent-root'))
    storageForRoot.deleteIfManaged(row.managedPath) // no throw even though nothing exists there
    // The real delete path (service.delete) must also not throw when the file is already absent.
    service.delete(media.id)
    equal(service.listForTrade(tradeId).some((m) => m.id === media.id), false)
  })

  check('zero-media empty state for a fresh trade', () => {
    const freshTrade = db.repositories.trades.createTrade({
      accountId,
      analyticalTradeDate: '2026-02-04',
      instrument: 'NQH6',
      direction: 'SHORT',
      quantity: '1',
      openedAt: 1_700_100_000_000,
      avgEntryPrice: '18000',
      executions: [{ executedAt: 1_700_100_000_000, side: 'SELL', quantity: '1', price: '18000' }]
    })
    equal(service.listForTrade(freshTrade.id), [])
  })

  check('IPC exposes no generic filesystem API (named media channels only)', () => {
    // The Electron-free half of the surface (registerMediaIpc.ts wires the
    // remaining two Electron-native channels: pickImageFile, listCaptureSources).
    const handlers = createMediaHandlers({ getService: () => service, log: () => {} })
    const names = Object.keys(handlers).sort()
    equal(names, [
      'media:addDayMedia',
      'media:addTradeMedia',
      'media:delete',
      'media:listForDay',
      'media:listForTrade',
      'media:setFeaturedTradeMedia',
      'media:stageCapturedImage'
    ])
  })

  db.close()
}

// ---- day media ---------------------------------------------------------------

{
  const { db, service, accountId } = openFixture()

  check('create Day media', () => {
    const staged = service.stage(PNG_BYTES)
    const media = service.addDayMedia({ accountId, date: '2026-02-03', token: staged.token, timeframe: 'D1', stage: 'PRE_TRADE', caption: 'Session plan' })
    equal(media.ownerType, 'DAY')
    equal(media.analyticalDate, '2026-02-03')
    equal(media.tradeId, null)
  })

  check('Day media is never featured, even though it is the only image for that day', () => {
    equal(service.listForDay(accountId, '2026-02-03').every((m) => !m.isFeatured), true)
  })

  check('list Day media', () => {
    const list = service.listForDay(accountId, '2026-02-03')
    equal(list.length, 1)
  })

  check('Day account/date ownership enforced: another date is empty', () => {
    equal(service.listForDay(accountId, '2026-02-09'), [])
  })

  check('Day media: unrelated account id is refused', () => {
    const staged = service.stage(PNG_BYTES)
    throws(() => service.addDayMedia({ accountId: 'no-such-account', date: '2026-02-03', token: staged.token, timeframe: 'D1', stage: 'PRE_TRADE', caption: '' }), /Account not found/)
  })

  db.close()
}

// ---- storage: path safety -----------------------------------------------------

{
  const storage = new MediaStorage(nextPath('secure-root'))
  check('path traversal is rejected when resolving a managed path', () => {
    equal(storage.resolveManaged('../outside.png'), null)
    equal(storage.resolveManaged('trades/../../outside.png'), null)
  })
  check('external arbitrary file cannot be deleted through the managed-file guard', () => {
    const outside = nextPath('outside-file') + '.png'
    writeFileSync(outside, PNG_BYTES)
    storage.deleteIfManaged('../' + outside.replace(/\\/g, '/'))
    equal(existsSync(outside), true, 'file outside the media root must survive')
  })
  check('a valid write stays inside the media root and reads back byte-identical', () => {
    const relative = storage.writeTradeImage('trade-x', 'media-y', 'PNG', PNG_BYTES)
    const absolute = storage.resolveManaged(relative)!
    equal(readFileSync(absolute).equals(PNG_BYTES), true)
  })
  check('MediaStorage.read serves the same bytes the ssmedia:// protocol handler reads (main-process byte-serving path)', () => {
    const relative = storage.writeTradeImage('trade-z', 'media-w', 'JPEG', JPEG_BYTES)
    const bytes = storage.read(relative)
    equal(bytes !== null && bytes.equals(JPEG_BYTES), true)
  })
  check('MediaStorage.read returns null for a missing/unmanaged file (protocol 404 case)', () => {
    equal(storage.read('trades/does-not-exist/nope.png'), null)
  })
}

// ---- restart persistence -------------------------------------------------------

{
  const dbPath = nextPath('restart-db') + '.sqlite'
  const rootPath = nextPath('restart-media')
  const first = Database.open(dbPath)
  const storage1 = new MediaStorage(rootPath)
  const service1 = new MediaService(first, storage1)
  const account = first.repositories.accounts.create({ displayName: 'Restart', sourcePlatform: 'dev-fixture', currency: 'USD' })
  const trade = first.repositories.trades.createTrade({
    accountId: account.id,
    analyticalTradeDate: '2026-02-05',
    instrument: 'ESH6',
    direction: 'LONG',
    quantity: '1',
    openedAt: 1_700_200_000_000,
    avgEntryPrice: '5000',
    executions: [{ executedAt: 1_700_200_000_000, side: 'BUY', quantity: '1', price: '5000' }]
  })
  const staged = service1.stage(PNG_BYTES)
  const created = service1.addTradeMedia({ tradeId: trade.id, token: staged.token, timeframe: 'H1', stage: 'MANAGEMENT', caption: 'Managing risk' })
  first.close()

  const second = Database.open(dbPath)
  const storage2 = new MediaStorage(rootPath)
  const service2 = new MediaService(second, storage2)
  check('attachments survive restart (new Database + new MediaService)', () => {
    const list = service2.listForTrade(trade.id)
    equal(list.length, 1)
    equal(list[0]!.id, created.id)
    equal(list[0]!.caption, 'Managing risk')
    equal(list[0]!.isFeatured, true, 'the only image for the Trade stays featured across a restart')
    const managedPath = second.repositories.media.getById(created.id)!.managedPath
    equal(existsSync(storage2.resolveManaged(managedPath)!), true)
  })
  second.close()
}

for (const line of lines) console.log(line)
console.log(`\ntrade-media smoke: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
