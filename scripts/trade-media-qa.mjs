// Trade Media / Chart Evidence rendering QA (Checkpoint 014 fix). Launches the
// REAL built app against a FRESH, throwaway userData directory (development
// seed data only — never the user's real solid-skill-dev database), drives
// the renderer over the Chrome DevTools Protocol, and proves the bug this
// checkpoint fixes cannot recur: a synthetic PNG staged and attached through
// the real IPC surface must actually RENDER as a real <img> in the real
// Electron renderer (naturalWidth/naturalHeight > 0), not just persist as
// metadata. Also exercises the featured/Overview-chart invariants end-to-end
// through the UI (star control, Overview panel, delete-featured fallback)
// and confirms Day Chart Evidence renders through the same path.
// Usage: node scripts/trade-media-qa.mjs   (QA_SHOTS=<dir> saves screenshots)
// Development tooling only.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

const electronPath = createRequire(import.meta.url)('electron')
const userData = mkdtempSync(join(tmpdir(), 'solid-skill-media-qa-'))
const shotDir = process.env.QA_SHOTS
if (shotDir) mkdirSync(shotDir, { recursive: true })
const PORT = 9338
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${String(detail).slice(0, 500)}`}`)
}
const info = (line) => console.log(`INFO  ${line}`)

// A real, minimal, valid 1x1 PNG (magic bytes + IHDR/IDAT/IEND) — enough for
// detectImageFormat and for a real <img> to decode and report naturalWidth=1.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

// A real grayscale PNG of an arbitrary size — the Trade Review geometry checks
// need true 16:9 / portrait captures, which the 1x1 fixture above cannot show.
function makePngB64(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1) // filter byte 0 stays 0
    for (let x = 0; x < width; x += 1) raw[row + 1 + x] = (x + y) % 256
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]).toString('base64')
}

const json = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.ready = new Promise((ok, err) => {
      this.ws.onopen = ok
      this.ws.onerror = err
    })
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      const p = this.pending.get(msg.id)
      if (p) {
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      }
    }
  }
  send(method, params = {}) {
    const id = (this.id += 1)
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  async eval(expression) {
    // A hard ceiling so a renderer-side promise that never settles (a bug in
    // the page, not in this script) cannot hang the whole QA run forever.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('CDP eval timed out after 20s')), 20000))
    const r = await Promise.race([this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), timeout])
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.value
  }
}

let app = null
async function launch() {
  app = spawn(electronPath, [resolve('.'), `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], {
    // Leave SOLID_SKILL_DEV_SEED at its default (enabled) so this fresh,
    // throwaway userData gets seeded demo Trades to attach media to.
    env: { ...process.env },
    stdio: 'ignore'
  })
  app.exited = new Promise((r) => app.on('exit', r))
  let target = null
  for (let i = 0; i < 100 && !target; i += 1) {
    await sleep(200)
    try {
      target = (await json('/json')).find((t) => t.type === 'page')
    } catch {
      /* not up yet */
    }
  }
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  for (let i = 0; i < 50; i += 1) {
    if (await cdp.eval('typeof window.solidSkill !== "undefined" && document.readyState === "complete"')) break
    await sleep(200)
  }
  await sleep(800)
  return cdp
}
async function close(cdp) {
  const browser = new Cdp((await json('/json/version')).webSocketDebuggerUrl)
  await browser.ready
  browser.send('Browser.close').catch(() => {})
  await Promise.race([app.exited, sleep(15000)])
  cdp.ws.close()
  await sleep(500)
}
const body = (c) => c.eval('document.body.innerText')
// offsetParent !== null excludes the previously active section, which App.tsx
// deliberately keeps mounted display:none'd underneath an open overlay (so
// Back navigation preserves its state) — without this filter, a generic text
// match can silently click a same-labelled control in that hidden leftover.
const click = (c, sel, text) =>
  c.eval(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => ${
      text === undefined ? 'true' : `b.textContent.trim().startsWith(${JSON.stringify(text)})`
    } && !b.disabled && b.offsetParent !== null)
    if (!el) return false
    el.click()
    return true
  })()`)
const clickButton = (c, text) => click(c, 'button', text)
async function shot(c, name) {
  if (!shotDir) return
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.data, 'base64'))
}
const api = (c, expr) => c.eval(`(async () => JSON.stringify(await ${expr}))()`).then(JSON.parse)
async function nav(c, section) {
  await clickButton(c, section)
  await sleep(600)
}

/** Stages a synthetic PNG and attaches it to a Trade through the real media IPC surface (not a test hook). */
async function addTradeMedia(c, tradeId, timeframe, stage, caption, pngB64 = PNG_B64) {
  return api(
    c,
    `(async () => {
      const bin = atob('${pngB64}')
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
      const staged = await window.solidSkill.media.stageCapturedImage(bytes.buffer)
      if (!staged.ok) return staged
      return window.solidSkill.media.addTradeMedia({ tradeId: '${tradeId}', token: staged.data.token, timeframe: '${timeframe}', stage: '${stage}', caption: '${caption}' })
    })()`
  )
}

async function addDayMedia(c, accountId, date, timeframe, stage, caption) {
  return api(
    c,
    `(async () => {
      const bin = atob('${PNG_B64}')
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
      const staged = await window.solidSkill.media.stageCapturedImage(bytes.buffer)
      if (!staged.ok) return staged
      return window.solidSkill.media.addDayMedia({ accountId: '${accountId}', date: '${date}', token: staged.data.token, timeframe: '${timeframe}', stage: '${stage}', caption: '${caption}' })
    })()`
  )
}

// Waits for every img[src^="ssmedia://"] on the page to finish loading (or
// error), then reports [{src, naturalWidth, naturalHeight, ok}] for each —
// the exact assertion the manual QA bug report needed: metadata existing is
// not enough, the bytes must actually decode into a real image.
async function ssmediaImageReport(c) {
  return c.eval(`(async () => {
    // The previously active section (e.g. Journal) stays mounted, just
    // display:none'd, underneath an open overlay (App.tsx: "toggled via CSS,
    // not unmounted", so Back navigation keeps its state) — offsetParent is
    // null for anything inside a display:none ancestor, so this scopes the
    // check to what is actually visible on screen right now.
    const imgs = [...document.querySelectorAll('img[src^="ssmedia://"]')].filter((img) => img.offsetParent !== null)
    await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((r) => {
      // Bounded wait: an image that never fires load OR error (should not
      // happen, but must not hang this QA run forever if it somehow does)
      // still resolves after 5s, and naturalWidth/Height simply read 0.
      setTimeout(r, 5000)
      img.addEventListener('load', r, { once: true })
      img.addEventListener('error', r, { once: true })
    })))
    return JSON.stringify(imgs.map((img) => ({
      src: img.src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight
    })))
  })()`).then(JSON.parse)
}

try {
  const c = await launch()

  const trades = (await api(c, 'window.solidSkill.trades.list()')).data.trades
  check('development seed provides at least two Trades to attach media to', trades.length >= 2, trades.length)
  const tradeA = trades[0]
  info(`tradeA = ${tradeA.id} (${tradeA.instrument}, ${tradeA.tradeDate})`)

  // ---- backend invariants through the real IPC surface (not the smoke suite's direct service calls) ----
  const first = await addTradeMedia(c, tradeA.id, 'M15', 'ENTRY', 'first')
  check('addTradeMedia via IPC succeeds', first.ok, JSON.stringify(first))
  check('the first image attached is featured automatically', first.ok && first.data.isFeatured === true)

  const second = await addTradeMedia(c, tradeA.id, 'H4', 'PRE_TRADE', 'second')
  check('addTradeMedia (second image) via IPC succeeds', second.ok, JSON.stringify(second))
  check('the second image is not featured', second.ok && second.data.isFeatured === false)
  info(`first.id = ${first.data.id}, second.id = ${second.data.id}`)

  const setFeatured = await api(
    c,
    `window.solidSkill.media.setFeaturedTradeMedia({ tradeId: '${tradeA.id}', mediaId: '${second.data.id}' })`
  )
  check('setFeaturedTradeMedia succeeds', setFeatured.ok, JSON.stringify(setFeatured))
  check(
    'setFeaturedTradeMedia: exactly one featured item afterward, and it is the chosen one',
    setFeatured.ok &&
      setFeatured.data.filter((m) => m.isFeatured).length === 1 &&
      setFeatured.data.find((m) => m.id === second.data.id).isFeatured === true
  )

  // ---- the actual rendering bug: open Journal -> Trade -> Charts and check the real <img> elements ----
  await nav(c, 'Journal')
  await click(c, 'tbody tr')
  await sleep(500)
  await clickButton(c, 'Charts')
  await sleep(500)
  await shot(c, '01-journal-trade-charts')
  let report = await ssmediaImageReport(c)
  info(`Journal quick-preview Charts tab ssmedia images: ${JSON.stringify(report)}`)
  check(
    'Journal quick-preview Charts tab: both chart thumbnails actually render (naturalWidth/Height > 0)',
    report.length === 2 && report.every((r) => r.naturalWidth > 0 && r.naturalHeight > 0),
    JSON.stringify(report)
  )

  // full-size preview: click the first VISIBLE gallery tile (a <button> wrapping
  // an ssmedia <img>) — the previous section stays mounted display:none'd
  // underneath, so this must not match its (identical-looking) leftover tiles.
  const tileClicked = await c.eval(`(() => {
    const tile = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && b.querySelector('img[src^="ssmedia://"]'))
    if (!tile) return false
    tile.click()
    return true
  })()`)
  await sleep(400)
  await shot(c, '02-lightbox')
  const lightbox = await c.eval(`(() => {
    const img = document.querySelector('[role=dialog] img[src^="ssmedia://"]')
    return img ? { src: img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight } : null
  })()`)
  info(`Lightbox preview: ${JSON.stringify(lightbox)}`)
  check('gallery tile is clickable', tileClicked)
  check(
    'full preview (lightbox) renders the real image',
    lightbox !== null && lightbox.naturalWidth > 0 && lightbox.naturalHeight > 0,
    JSON.stringify(lightbox)
  )
  // The close button is always the LAST action in ChartLightbox's header (see
  // ChartLightbox.tsx) — any extra action (e.g. delete) is rendered before it.
  await c.eval(`(() => {
    const buttons = [...document.querySelectorAll('[role=dialog] button')]
    buttons[buttons.length - 1]?.click()
  })()`)
  await sleep(200)

  const preNavCheck = await api(c, `window.solidSkill.media.listForTrade('${tradeA.id}')`)
  info(`independent listForTrade right before navigating: ${JSON.stringify(preNavCheck)}`)

  // ---- Overview shows the real featured chart, not the illustrative fallback ----
  await clickButton(c, 'Open full review')
  await sleep(600)
  await shot(c, '03-trade-review-overview')
  check('Trade Review (full) opens', (await c.eval(`document.querySelector('h1')?.innerText`)) === 'Trade Review')
  // The previous section (Journal) stays mounted display:none'd underneath
  // this overlay (see App.tsx), so every DOM query here must filter to
  // offsetParent !== null (actually visible), not just "exists in the DOM".
  let overviewImg = await c.eval(`(() => {
    const img = [...document.querySelectorAll('img[src^="ssmedia://"]')].find((el) => el.offsetParent !== null)
    return img ? { src: img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight } : null
  })()`)
  info(`Overview chart evidence image: ${JSON.stringify(overviewImg)}`)
  check(
    'Overview shows the real featured chart image (not the illustrative Execution Visualization) and it renders',
    overviewImg !== null && overviewImg.src.includes(second.data.id) && overviewImg.naturalWidth > 0,
    JSON.stringify(overviewImg)
  )

  // ---- switching the featured chart from the Charts tab star control updates Overview ----
  await clickButton(c, 'Charts')
  await sleep(400)
  const allTitledButtons = await c.eval(
    `JSON.stringify([...document.querySelectorAll('button[title]')].filter((b) => b.offsetParent !== null).map((b) => b.title))`
  )
  info(`visible titled buttons on the Charts tab: ${allTitledButtons}`)
  const starToggled = await c.eval(`(() => {
    const stars = [...document.querySelectorAll('button[title]')].filter((b) => b.offsetParent !== null)
    // title="Show in Overview" (EN copy) marks the NOT-yet-featured star; the
    // already-featured one is titled "Featured chart" (see ChartGallery.tsx /
    // journal.json). A no-op click on an already-featured star would make
    // this a false pass, so match on the exact not-yet-featured title.
    const target = stars.find((b) => b.title === 'Show in Overview')
    if (!target) return false
    target.click()
    return true
  })()`)
  await sleep(500)
  check('Set as Overview star control is present and clickable', starToggled)
  const afterStarClickDb = await api(c, `window.solidSkill.media.listForTrade('${tradeA.id}')`)
  info(`DB state right after star click: ${JSON.stringify(afterStarClickDb)}`)
  await clickButton(c, 'Overview')
  await sleep(400)
  overviewImg = await c.eval(`(() => {
    const img = [...document.querySelectorAll('img[src^="ssmedia://"]')].find((el) => el.offsetParent !== null)
    return img ? { src: img.src, naturalWidth: img.naturalWidth } : null
  })()`)
  info(`Overview after star toggle: ${JSON.stringify(overviewImg)}`)
  check(
    'Overview reflects the newly chosen featured image and it renders',
    overviewImg !== null && overviewImg.src.includes(first.data.id) && overviewImg.naturalWidth > 0,
    JSON.stringify(overviewImg)
  )

  const afterToggle = await api(c, `window.solidSkill.media.listForTrade('${tradeA.id}')`)
  check(
    'exactly one featured item after the UI toggle',
    afterToggle.ok && afterToggle.data.filter((m) => m.isFeatured).length === 1
  )

  // ---- deleting the featured image falls back deterministically ----
  const beforeDelete = afterToggle.data
  const featuredNow = beforeDelete.find((m) => m.isFeatured)
  const deleteResult = await api(c, `window.solidSkill.media.delete('${featuredNow.id}')`)
  check('delete of the featured image succeeds', deleteResult.ok)
  const afterDelete = await api(c, `window.solidSkill.media.listForTrade('${tradeA.id}')`)
  check(
    'after deleting the featured image, the remaining image is promoted to featured (deterministic fallback)',
    afterDelete.ok && afterDelete.data.length === 1 && afterDelete.data[0].isFeatured === true,
    JSON.stringify(afterDelete)
  )

  // ---- Checkpoint 015B: main Chart Evidence viewer geometry in Trade Review → Strategy ----
  // Real-sized captures: a fullscreen-TradingView-like 16:9 and a portrait
  // one, added alongside the remaining (featured) 1x1 fixture.
  const wide = await addTradeMedia(c, tradeA.id, 'H1', 'ENTRY', 'wide', makePngB64(1600, 900))
  const tall = await addTradeMedia(c, tradeA.id, 'M5', 'ENTRY', 'tall', makePngB64(450, 800))
  check('16:9 and portrait captures attach via IPC', wide.ok && tall.ok, JSON.stringify({ wide, tall }))

  // Re-open Trade Review so its media list includes the new captures, on a
  // typical wide desktop viewport (the size where the old fixed 320px-high
  // box letterboxed a 16:9 chart the most).
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await clickButton(c, 'Back')
  await sleep(500)
  if (!(await clickButton(c, 'Open full review'))) {
    await click(c, 'tbody tr')
    await sleep(500)
    await clickButton(c, 'Open full review')
  }
  await sleep(700)
  await click(c, '[role=tab]', 'Strategy')
  await sleep(300)

  const viewerGeometry = () =>
    c.eval(`(async () => {
      const frame = [...document.querySelectorAll('button[class*="chartEvidenceFrame"]')].find((el) => el.offsetParent !== null)
      if (!frame) return null
      const img = frame.querySelector('img')
      if (!img.complete) await new Promise((r) => { img.addEventListener('load', r, { once: true }); setTimeout(r, 5000) })
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const block = frame.parentElement
      const cs = getComputedStyle(block)
      const available = block.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const f = frame.getBoundingClientRect()
      const tabs = [...document.querySelectorAll('[role=tablist][aria-label="Trade detail sections"]')].find((el) => el.offsetParent !== null)
      const t = tabs.getBoundingClientRect()
      const selectedTab = tabs.querySelector('[aria-selected=true]')?.textContent
      const pressed = [...document.querySelectorAll('button[aria-pressed=true] img')].filter((el) => el.offsetParent !== null).map((el) => el.src)
      return {
        src: img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        imgW: img.clientWidth, imgH: img.clientHeight, frameW: f.width, frameH: f.height,
        centerOffset: (f.left + f.width / 2) - (block.getBoundingClientRect().left + block.getBoundingClientRect().width / 2), frameBottom: f.bottom,
        available, innerHeight: window.innerHeight, objectFit: getComputedStyle(img).objectFit,
        tabsTop: t.top, tabsBottom: t.bottom, selectedTab, pressed
      }
    })()`)
  const clickThumb = (id) =>
    c.eval(`(() => {
      const b = [...document.querySelectorAll('button[aria-pressed] img')].find((el) => el.offsetParent !== null && el.src.includes('${id}'))?.closest('button')
      if (!b) return false
      b.click()
      return true
    })()`)
  const near = (a, b, tol) => Math.abs(a - b) <= tol

  const wideClicked = await clickThumb(wide.data.id)
  await sleep(400)
  const g16 = await viewerGeometry()
  await shot(c, '05-trade-review-strategy-16x9')
  info(`16:9 geometry: ${JSON.stringify(g16)}`)
  const oldCapWidth = Math.min(g16?.available ?? 0, 320 * (16 / 9))
  info(`previous fixed-box rendering would have been ${oldCapWidth.toFixed(0)}x${(oldCapWidth * 9 / 16).toFixed(0)} inside ${g16?.available}px`)
  check('clicking a thumbnail switches the main chart to it (no lightbox)', wideClicked && g16 !== null && g16.src.includes(wide.data.id) && !(await c.eval(`!!document.querySelector('[role=dialog]')`)), JSON.stringify(g16))
  check('selected thumbnail is marked (aria-pressed) and is the only one', g16 !== null && g16.pressed.length === 1 && g16.pressed[0].includes(wide.data.id), JSON.stringify(g16?.pressed))
  check('Strategy tab stays selected while the chart is shown', g16?.selectedTab === 'Strategy', g16?.selectedTab)
  check('16:9 image decodes at its real size', g16?.naturalWidth === 1600 && g16?.naturalHeight === 900, JSON.stringify(g16))
  check('16:9 frame preserves the image aspect ratio (no crop / no distortion)', g16 !== null && near(g16.imgW / g16.imgH, 16 / 9, 0.02) && g16.objectFit === 'contain', JSON.stringify(g16))
  check('16:9 chart uses the full column width (no side letterboxing)', g16 !== null && g16.imgW >= g16.available - 4, JSON.stringify(g16))
  check('16:9 chart is substantially larger than the old 320px-high box', g16 !== null && g16.imgH >= 450 && g16.imgW > oldCapWidth * 1.3, JSON.stringify(g16))
  check('whole 16:9 chart and the Strategy tab controls are on screen together', g16 !== null && g16.frameBottom <= g16.innerHeight && g16.tabsTop >= 0 && g16.tabsBottom < g16.innerHeight, JSON.stringify(g16))

  const tallClicked = await clickThumb(tall.data.id)
  await sleep(400)
  const gTall = await viewerGeometry()
  await shot(c, '06-trade-review-strategy-portrait')
  info(`portrait geometry: ${JSON.stringify(gTall)}`)
  check('switching to the portrait thumbnail updates the main chart', tallClicked && gTall?.src.includes(tall.data.id), JSON.stringify(gTall))
  check('portrait frame preserves the image aspect ratio', gTall !== null && near(gTall.imgW / gTall.imgH, 450 / 800, 0.02), JSON.stringify(gTall))
  check('portrait chart is height-bounded (stays on screen) and centered, not stretched to full width', gTall !== null && gTall.frameBottom <= gTall.innerHeight && gTall.frameW < gTall.available - 20 && near(gTall.centerOffset, 0, 2), JSON.stringify(gTall))

  const expandClicked = await click(c, 'button[aria-label="Open full preview"]')
  await sleep(400)
  const expanded = await c.eval(`(() => {
    const img = document.querySelector('[role=dialog] img[src^="ssmedia://"]')
    return img ? { src: img.src, naturalWidth: img.naturalWidth } : null
  })()`)
  check('explicit Expand action opens the full preview of the selected chart', expandClicked && expanded !== null && expanded.src.includes(tall.data.id) && expanded.naturalWidth === 450, JSON.stringify(expanded))
  await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(200)
  check('Escape closes the full preview', !(await c.eval(`!!document.querySelector('[role=dialog]')`)))
  await click(c, 'button[class*="chartEvidenceFrame"]')
  await sleep(400)
  const frameOpened = await c.eval(`document.querySelector('[role=dialog] img[src^="ssmedia://"]')?.src ?? null`)
  check('clicking the main chart still opens the full preview', frameOpened !== null && frameOpened.includes(tall.data.id), frameOpened)
  await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(200)
  await c.send('Emulation.clearDeviceMetricsOverride')

  // ---- Day media renders through the same path ----
  const dayResult = await addDayMedia(c, tradeA.accountId, tradeA.tradeDate, 'D1', 'PRE_TRADE', 'session plan')
  check('addDayMedia via IPC succeeds', dayResult.ok, JSON.stringify(dayResult))
  check('Day media is never featured', dayResult.ok && dayResult.data.isFeatured === false)

  await nav(c, 'Calendar')
  // "This month" means the real current month, which is not necessarily the
  // month of the (fixed, seeded) Trade date — click "Previous month" until
  // the header matches the Trade's actual month, rather than assuming any
  // fixed offset from today.
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  const [tYear, tMonth] = tradeA.tradeDate.split('-')
  const targetLabel = `${MONTH_NAMES[Number(tMonth) - 1]} ${tYear}`
  let monthLabel = await c.eval(`document.querySelector('[class*="monthLabel"]')?.textContent ?? ''`)
  for (let i = 0; i < 36 && monthLabel !== targetLabel; i += 1) {
    const clicked = await click(c, 'button[aria-label="Previous month"]')
    if (!clicked) break
    await sleep(150)
    monthLabel = await c.eval(`document.querySelector('[class*="monthLabel"]')?.textContent ?? ''`)
  }
  info(`Calendar navigated to "${monthLabel}" (target "${targetLabel}")`)
  check('Calendar month navigation reached the Trade\'s actual month', monthLabel === targetLabel, monthLabel)
  await sleep(300)
  const dayOpened = await c.eval(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && /trades?/.test(x.innerText) && /^\\d+/.test(x.innerText.trim())); if (!b) return false; b.click(); return true })()`
  )
  await sleep(700)
  await shot(c, '04-day-review')
  const dayReportRaw = await ssmediaImageReport(c)
  info(`Day Review ssmedia images: ${JSON.stringify(dayReportRaw)}`)
  check(
    'Day Review opened and its Chart Evidence image actually renders',
    dayOpened && dayReportRaw.length >= 1 && dayReportRaw.every((r) => r.naturalWidth > 0 && r.naturalHeight > 0),
    JSON.stringify(dayReportRaw)
  )

  await close(c)
  console.log(`\ntrade-media QA: ${pass} passed, ${fail} failed`)
} catch (e) {
  console.log('QA ERROR', e)
  fail += 1
} finally {
  try {
    app?.kill()
  } catch {
    /* already exited */
  }
  await sleep(500)
  rmSync(userData, { recursive: true, force: true })
}
process.exit(fail === 0 ? 0 : 1)
