// Weekly Review real-app QA (Checkpoint 015). Launches the REAL built app
// (`npm run build` first) against a THROWAWAY COPY of the solid-skill-dev
// database + media folder, so real development data (incl. imported MT5 Trade
// facts) is never opened for writing. Drives the renderer over the Chrome
// DevTools Protocol:
//   - Demo Account 50K: a seeded week renders from persisted data; authored
//     reflection typed through the UI autosaves exactly as typed
//   - Day / Trade drilldown reuse the existing screens and Back returns to the
//     same week; Day Note edits autosave from Day Review
//   - EN ↔ ES switch keeps authored text byte-identical
//   - MT5 account: weeks derived from real imported data, no fabricated
//     Strategy / evaluations, the reflection does not leak across accounts
//   - progress bars, live achievements, scorecard autosave (score click, note,
//     clear, isolation from the reflection and from other accounts)
//   - restart persistence; no historical Trade fact changed; media reused
// Usage: node scripts/weekly-review-qa.mjs   (QA_SHOTS=<dir> saves screenshots)
// Development tooling only.
import { spawn } from 'node:child_process'
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const electronPath = createRequire(import.meta.url)('electron')
const source = process.env.QA_SOURCE ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'solid-skill-dev')
const userData = mkdtempSync(join(tmpdir(), 'solid-skill-weekly-qa-'))
const shotDir = process.env.QA_SHOTS
if (shotDir) mkdirSync(shotDir, { recursive: true })
const PORT = 9341
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${String(detail).slice(0, 500)}`}`)
}
const info = (line) => console.log(`INFO  ${line}`)

for (const f of ['solid-skill.db', 'solid-skill.db-wal', 'solid-skill.db-shm']) {
  if (existsSync(join(source, f))) copyFileSync(join(source, f), join(userData, f))
}
if (existsSync(join(source, 'media'))) cpSync(join(source, 'media'), join(userData, 'media'), { recursive: true })
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
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.value
  }
}

let app = null
async function launch() {
  app = spawn(electronPath, [resolve('.'), `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], {
    env: { ...process.env, SOLID_SKILL_DEV_SEED: '0' },
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
const click = (c, sel, text) =>
  c.eval(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => ${
      text === undefined ? 'true' : `b.textContent.trim().startsWith(${JSON.stringify(text)})`
    } && !b.disabled && b.offsetParent !== null)
    if (!el) return false
    el.click()
    return true
  })()`)
const title = (c) => c.eval(`document.querySelector('h1')?.innerText ?? ''`)
const api = (c, expr) => c.eval(`(async () => JSON.stringify(await ${expr}))()`).then(JSON.parse)
const triggerText = (c) =>
  c.eval(`(document.querySelector('button[aria-haspopup=listbox]')?.innerText ?? '').replace(/\\s+/g, ' ').trim()`)
async function shot(c, name) {
  if (!shotDir) return
  const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.data, 'base64'))
}
async function nav(c, section) {
  await click(c, 'aside button', section)
  await sleep(700)
}
async function chooseAccount(c, label) {
  await click(c, 'button[aria-haspopup=listbox]')
  await sleep(150)
  const ok = await click(c, '[role=option] button', label)
  await sleep(900)
  return ok
}
const weekShown = (c) => c.eval(`document.querySelector('[data-week-start]')?.getAttribute('data-week-start') ?? null`)
async function jumpToWeek(c, weekStart) {
  const ok = await c.eval(`(() => {
    const s = document.querySelector('select[aria-label]')
    if (!s || ![...s.options].some((o) => o.value === ${JSON.stringify(weekStart)})) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(s, ${JSON.stringify(weekStart)})
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(900)
  return ok
}
async function typeInto(c, selector, text) {
  await c.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); return true })()`)
  await c.send('Input.insertText', { text })
  await sleep(100)
  // Blur flushes immediately (the debounce would too, ~0.8 s later).
  await c.eval(`document.querySelector(${JSON.stringify(selector)}).blur()`)
  await sleep(1200)
}
const valueOf = (c, selector) => c.eval(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`)
const saveStatus = (c) => c.eval(`document.querySelector('[data-save-status]')?.getAttribute('data-save-status') ?? null`)
const tradeRows = (c) => c.eval(`document.querySelectorAll('[data-section=trades] tbody tr').length`)
const progressOf = (c, id) => c.eval(`document.querySelector('[data-progress=${id}]')?.getAttribute('data-percent') ?? null`)
const earnedChips = (c) =>
  c.eval(`[...document.querySelectorAll('[data-section=achievements] [data-achievement]')].filter((e) => e.getAttribute('data-earned') === 'true').map((e) => e.getAttribute('data-achievement'))`)
const chipCount = (c) => c.eval(`document.querySelectorAll('[data-section=achievements] [data-achievement]').length`)
const scorecardStatus = (c) => c.eval(`document.querySelector('[data-section=scorecard] [data-save-status]')?.getAttribute('data-save-status') ?? null`)
const pressedScore = (c, dim) =>
  c.eval(`document.querySelector('[data-dimension=${dim}] button[aria-pressed=true]')?.getAttribute('data-score') ?? null`)
async function clickScore(c, dim, score) {
  await c.eval(`document.querySelector('[data-dimension=${dim}] button[data-score="${score}"]').click()`)
  await sleep(700)
}
/** Expected bar values from Trade facts, mirroring lib/weeklyReview.ts computeWeekProgress. */
function expectedProgress(trades) {
  const withStrategy = trades.filter((t) => t.strategy !== null)
  const pass = withStrategy.reduce((n, t) => n + t.compliance.pass, 0)
  const failN = withStrategy.reduce((n, t) => n + t.compliance.fail, 0)
  const reviewed = withStrategy.filter((t) => {
    const k = t.compliance
    return k.pass + k.fail + k.na + k.unreviewed > 0 && k.unreviewed === 0
  }).length
  return {
    compliance: pass + failN === 0 ? '' : String(Math.round((pass / (pass + failN)) * 100)),
    review: trades.length === 0 ? '' : String(Math.round((reviewed / trades.length) * 100))
  }
}

function digest(dir, tables) {
  const raw = new DatabaseSync(join(dir, 'solid-skill.db'), { readOnly: true })
  try {
    return tables
      .map((t) =>
        raw
          .prepare(`SELECT * FROM ${t} ORDER BY 1`)
          .all()
          .map((r) => JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
          .join('\n')
      )
      .join('\n---\n')
  } finally {
    raw.close()
  }
}
const FACT_TABLES = ['trades', 'executions', 'trade_rule_evaluations', 'trade_notes', 'trade_media', 'strategy_versions', 'rules']
function countFiles(dir) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).reduce((n, f) => (statSync(join(dir, f)).isDirectory() ? n + countFiles(join(dir, f)) : n + 1), 0)
}

// Pure Sunday-start week arithmetic (mirrors src/shared/week.ts).
const weekStartOf = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}
const weekEndOf = (start) => {
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 6)
  return d.toISOString().slice(0, 10)
}

const FORECAST = 'Esperaba rango el lunes;\nNQ expandió el miércoles — “sin FOMO”.  '
const WENT_WELL = 'Waited for my levels.\n\tKept size constant.'
const DAY_NOTE = 'Plan: patience at the open.\nWhat happened: two clean entries.'
const ACTUAL = 'Rotational Mon–Tue; expansion Wednesday.'
const SCORE_NOTE = '  Respeté el stop — “sin revenge”  '
const SCORES = { discipline: 4, patience: 3, risk_management: 5, execution_quality: 3, focus: 2, review_quality: 4 }

try {
  const factsBefore = digest(userData, FACT_TABLES)
  const dayNotesBefore = digest(userData, ['day_notes'])
  const mediaFilesBefore = countFiles(join(userData, 'media'))
  let c = await launch()
  const accounts = (await api(c, 'window.solidSkill.accounts.list()')).data.accounts
  const demo = accounts.find((a) => a.displayName === 'Demo Account 50K')
  const mt5 = accounts.find((a) => a.displayName.startsWith('MT5'))
  check('dev data has Demo Account 50K and an MT5 account', Boolean(demo && mt5), JSON.stringify(accounts.map((a) => a.displayName)))
  const all = (await api(c, 'window.solidSkill.trades.list()')).data.trades
  const demoTrades = all.filter((t) => t.accountId === demo.id)
  const mt5Trades = all.filter((t) => t.accountId === mt5.id)
  const demoWeek = weekStartOf(demoTrades.filter((t) => t.strategy !== null).at(-1).tradeDate)
  const demoWeekTrades = demoTrades.filter((t) => weekStartOf(t.tradeDate) === demoWeek)
  info(`demo review week ${demoWeek} (${demoWeekTrades.length} trades); MT5 trades ${mt5Trades.length}`)

  // ---- Demo account ----------------------------------------------------------
  if (!(await triggerText(c)).startsWith(demo.displayName)) await chooseAccount(c, demo.displayName)
  await nav(c, 'Weekly Review')
  check('Weekly Review is a real workspace (not the placeholder)', (await title(c)) === 'Weekly Review' && !(await body(c)).includes('later checkpoint'))
  const today = await c.eval(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })()`)
  check('opens on the current (Sunday-start) week', (await weekShown(c)) === weekStartOf(today), `${await weekShown(c)} vs ${weekStartOf(today)}`)
  const currentDemo = demoTrades.filter((t) => weekStartOf(t.tradeDate) === weekStartOf(today)).length
  if (currentDemo === 0) {
    check('empty week: no-trades state shown, no fixture data', (await body(c)).includes('No Trades recorded for this account this week.') && (await tradeRows(c)) === 0)
    check('empty week: both progress bars are undefined ("—"), never 0% or 100%',
      (await progressOf(c, 'compliance')) === '' && (await progressOf(c, 'review')) === '')
    check('empty week: no trade-based achievement is earned',
      !(await earnedChips(c)).some((id) => ['tradesReviewed', 'noRuleFails', 'cleanProcess'].includes(id)), await earnedChips(c))
  }
  check('section headings carry one lucide line icon each', await c.eval(`[...document.querySelectorAll('section[data-section] h2')].every((h) => h.querySelectorAll('svg.lucide').length === 1)`))
  await shot(c, '01-demo-current-week')

  check('jump to a seeded demo week', await jumpToWeek(c, demoWeek))
  check('week header shows the jumped week', (await weekShown(c)) === demoWeek)
  check(`Trades section lists the week's ${demoWeekTrades.length} persisted trades`, (await tradeRows(c)) === demoWeekTrades.length, await tradeRows(c))
  const reviewDto = (await api(c, `window.solidSkill.reviews.getWeek({ accountId: ${JSON.stringify(demo.id)}, weekStart: ${JSON.stringify(demoWeek)} })`)).data
  check('review facts are scoped to the demo account and the week bounds', reviewDto.trades.every((t) => t.accountId === demo.id && t.tradeDate >= demoWeek && t.tradeDate <= weekEndOf(demoWeek)))
  check('daily strip renders 7 day cells', (await c.eval(`document.querySelectorAll('[data-section=daily] button[data-date]').length`)) === 7)
  const ruleRows = await c.eval(`document.querySelectorAll('[data-section=rules] tbody tr').length`)
  check('rule review renders factual per-rule rows from exact versions', ruleRows > 0, ruleRows)
  const versionsShown = await c.eval(`[...document.querySelectorAll('[data-section=rules] [data-version-id]')].map((e) => e.getAttribute('data-version-id'))`)
  const expectedVersions = [...new Set(demoWeekTrades.filter((t) => t.strategy).map((t) => t.strategy.versionId))].sort()
  check('rule review groups by the exact versions the week was evaluated against', JSON.stringify([...versionsShown].sort()) === JSON.stringify(expectedVersions), `${versionsShown} vs ${expectedVersions}`)
  const outcomeText = await c.eval(`document.querySelector('[data-section=outcome]').innerText`)
  const processText = await c.eval(`document.querySelector('[data-section=process]').innerText`)
  check('outcome and process are separate sections', /NET P&L/i.test(outcomeText) && /COMPLIANCE/i.test(processText) && !/NET P&L/i.test(processText))
  const causal = /(caus(es|ed) (a )?(loss|win|profit)|leads to (losses|profits)|because you (won|lost))/i
  check('no causal language anywhere on the page', !causal.test(await body(c)))
  await shot(c, '02-demo-week-top')
  await c.eval(`document.querySelector('[data-section=rules]').scrollIntoView()`)
  await sleep(200)
  await shot(c, '03-demo-week-rules')

  // ---- authored reflection (typed through the UI) ------------------------------
  await typeInto(c, 'textarea[data-field=forecast]', FORECAST)
  await typeInto(c, 'textarea[data-field=wentWell]', WENT_WELL)
  check('autosave reports saved', (await saveStatus(c)) === 'saved', await saveStatus(c))
  const saved = (await api(c, `window.solidSkill.reviews.getWeek({ accountId: ${JSON.stringify(demo.id)}, weekStart: ${JSON.stringify(demoWeek)} })`)).data.reflection
  check('forecast persisted exactly as typed', saved.forecast === FORECAST, JSON.stringify(saved.forecast))
  check('what-went-well persisted exactly as typed', saved.wentWell === WENT_WELL, JSON.stringify(saved.wentWell))
  check('forecast edit timestamp recorded', typeof saved.forecastUpdatedAt === 'number')

  // ---- progress bars + achievements (derived, live) -----------------------------
  const exp = expectedProgress(demoWeekTrades)
  check(`Process Compliance bar = PASS / (PASS + FAIL) of the week (${exp.compliance || '—'}%)`, (await progressOf(c, 'compliance')) === exp.compliance, await progressOf(c, 'compliance'))
  check(`Review Completion bar = reviewed / all Trades of the week (${exp.review || '—'}%)`, (await progressOf(c, 'review')) === exp.review, await progressOf(c, 'review'))
  check('six achievement chips render', (await chipCount(c)) === 6, await chipCount(c))
  check('Forecast completed is not earned with only the forecast written', !(await earnedChips(c)).includes('forecastCompleted'))
  await typeInto(c, 'textarea[data-field=actual]', ACTUAL)
  check('Forecast completed is earned live once Actual is written', (await earnedChips(c)).includes('forecastCompleted'), await earnedChips(c))

  // ---- scorecard (autosaved, separate from the reflection) ------------------------
  await c.eval(`document.querySelector('[data-section=scorecard]').scrollIntoView()`)
  await sleep(200)
  check('scorecard renders the six dimensions', (await c.eval(`document.querySelectorAll('[data-section=scorecard] [data-dimension]').length`)) === 6)
  await clickScore(c, 'discipline', 4)
  check('clicking a score autosaves (scorecard status "saved")', (await scorecardStatus(c)) === 'saved', await scorecardStatus(c))
  check('the chosen score is shown as selected', (await pressedScore(c, 'discipline')) === '4')
  await typeInto(c, 'input[data-note=discipline]', SCORE_NOTE)
  let card = (await api(c, `window.solidSkill.reviews.getWeek({ accountId: ${JSON.stringify(demo.id)}, weekStart: ${JSON.stringify(demoWeek)} })`)).data
  check('scorecard score + note persisted exactly as entered', card.scorecard.discipline.score === 4 && card.scorecard.discipline.note === SCORE_NOTE, JSON.stringify(card.scorecard.discipline))
  check('scorecard saves did not alter the reflection', card.reflection.forecast === FORECAST && card.reflection.wentWell === WENT_WELL && card.reflection.actual === ACTUAL)
  await clickScore(c, 'discipline', 4)
  card = (await api(c, `window.solidSkill.reviews.getWeek({ accountId: ${JSON.stringify(demo.id)}, weekStart: ${JSON.stringify(demoWeek)} })`)).data
  check('selecting the current score again clears it (note kept)', card.scorecard.discipline.score === null && card.scorecard.discipline.note === SCORE_NOTE, JSON.stringify(card.scorecard.discipline))
  for (const [dim, score] of Object.entries(SCORES)) await clickScore(c, dim, score)
  card = (await api(c, `window.solidSkill.reviews.getWeek({ accountId: ${JSON.stringify(demo.id)}, weekStart: ${JSON.stringify(demoWeek)} })`)).data
  check('all six scores persisted', Object.entries(SCORES).every(([d, s]) => card.scorecard[d].score === s), JSON.stringify(card.scorecard))
  check('the rated counter shows 6 of 6', (await c.eval(`document.querySelector('[data-scorecard-rated]')?.getAttribute('data-scorecard-rated')`)) === '6')
  await shot(c, '04a-demo-scorecard')
  await typeInto(c, 'textarea[data-field=needsImprovement]', 'Size discipline after a loss.')
  await typeInto(c, 'textarea[data-field=nextWeekFocus]', 'Two A-grade setups max.')
  check('Review complete is earned once the scorecard and core reflection are written', (await earnedChips(c)).includes('reviewComplete'), await earnedChips(c))
  await c.eval(`document.querySelector('[data-section=progress]').scrollIntoView()`)
  await sleep(200)
  await shot(c, '04b-demo-progress-achievements')
  await c.eval(`document.querySelector('[data-section=trades]').scrollIntoView()`)
  await sleep(200)
  await shot(c, '04-demo-reflection-saved')

  // ---- trade drilldown: quick inspect then full review -------------------------
  await c.eval(`document.querySelector('[data-section=trades] tbody tr').click()`)
  await sleep(700)
  check('single click opens the quick inspect panel (Open full review)', (await c.eval(`document.querySelector('[data-section=trades]').innerText`)).includes('Open full review'))
  await shot(c, '05-demo-quick-inspect')
  await c.eval(`document.querySelector('[data-section=trades] tbody tr').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(900)
  check('double-click opens the existing full Trade Review', (await title(c)) === 'Trade Review')
  await shot(c, '06-demo-trade-review')
  await click(c, 'button', 'Back')
  await sleep(800)
  check('Back from Trade Review returns to the same week with the draft intact',
    (await title(c)) === 'Weekly Review' && (await weekShown(c)) === demoWeek && (await valueOf(c, 'textarea[data-field=forecast]')) === FORECAST)

  // ---- day drilldown + Day Note editing ----------------------------------------
  const noteDay = demoWeekTrades[0].tradeDate
  await c.eval(`document.querySelector('[data-section=daily] button[data-date="${noteDay}"]').click()`)
  await sleep(900)
  const dayBody = await body(c)
  check('day cell opens the existing Day Review for that account + date', (await title(c)) === 'Day Review' && dayBody.includes(demo.displayName))
  await typeInto(c, 'textarea[data-day-note]', DAY_NOTE)
  const dayDto = (await api(c, `window.solidSkill.trades.getDay({ accountId: ${JSON.stringify(demo.id)}, date: ${JSON.stringify(noteDay)} })`)).data
  check('Day Note edited in Day Review autosaves exactly as typed', dayDto.dayNote === DAY_NOTE, JSON.stringify(dayDto.dayNote))
  await shot(c, '07-day-review-note')
  await click(c, 'button', 'Back')
  await sleep(1000)
  check('Back from Day Review returns to the same week', (await title(c)) === 'Weekly Review' && (await weekShown(c)) === demoWeek)
  check('Day Note indicator appears on that day after returning',
    await c.eval(`!!document.querySelector('[data-section=daily] button[data-date="${noteDay}"] [data-indicator=note]')`))

  // ---- Chart Evidence (reused, read-only) ----------------------------------------
  const mediaRows = (() => {
    const raw = new DatabaseSync(join(userData, 'solid-skill.db'), { readOnly: true })
    try {
      return raw.prepare("SELECT m.id, m.owner_type, m.is_featured, m.analytical_date, t.analytical_trade_date AS trade_date FROM trade_media m LEFT JOIN trades t ON t.id = m.trade_id WHERE m.account_id = ?").all(demo.id)
    } finally {
      raw.close()
    }
  })()
  const featuredRow = mediaRows.find((m) => m.owner_type === 'TRADE' && m.is_featured === 1)
  if (featuredRow) {
    const mediaWeek = weekStartOf(featuredRow.trade_date)
    await jumpToWeek(c, mediaWeek)
    await c.eval(`document.querySelector('[data-section=charts]').scrollIntoView()`)
    await sleep(1200)
    const tiles = await c.eval(`[...document.querySelectorAll('[data-section=charts] [data-media-id]')].map((b) => ({ id: b.getAttribute('data-media-id'), src: b.querySelector('img').getAttribute('src'), loaded: b.querySelector('img').naturalWidth > 0 }))`)
    check('chart strip shows the featured Trade chart by its existing media id (ssmedia://)', tiles.some((t) => t.id === featuredRow.id && t.src === `ssmedia://${featuredRow.id}`), JSON.stringify(tiles))
    check('chart strip image loads through the read-only protocol', tiles.every((t) => t.loaded), JSON.stringify(tiles))
    const nonFeatured = mediaRows.filter((m) => m.owner_type === 'TRADE' && m.is_featured === 0).map((m) => m.id)
    check('non-featured Trade charts are not repeated in the compact strip', !tiles.some((t) => nonFeatured.includes(t.id)))
    await shot(c, '07b-chart-strip')
    await c.eval(`document.querySelector('[data-section=charts] [data-media-id]').click()`)
    await sleep(500)
    check('clicking a chart opens the existing lightbox (no delete action here)', await c.eval(`!!document.querySelector('[role=dialog]') && ![...document.querySelectorAll('[role=dialog] button')].some((b) => b.getAttribute('aria-label') === 'Delete')`))
    await shot(c, '07c-chart-lightbox')
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(300)
    await jumpToWeek(c, demoWeek)
  } else {
    info('no featured Trade chart in the dev data; chart strip checked for the empty state only')
  }

  // ---- EN ↔ ES -----------------------------------------------------------------
  await nav(c, 'Settings')
  await click(c, 'button', 'Español')
  await sleep(500)
  await nav(c, 'Weekly Review')
  await jumpToWeek(c, demoWeek)
  const esBody = await body(c)
  check('Spanish copy renders (product prose translated)', esBody.includes('Pronóstico / Intención') && /revisión de reglas/i.test(esBody) && esBody.includes('Qué salió bien'))
  check('Spanish scorecard / progress / achievements copy renders', /evaluación semanal/i.test(esBody) && esBody.includes('Cumplimiento del proceso') && /logros/i.test(esBody))
  check('scorecard note is byte-identical after switching to Spanish', (await valueOf(c, 'input[data-note=discipline]')) === SCORE_NOTE)
  check('canonical terms stay canonical in Spanish (Win Rate / P&L / PASS / FAIL)', /WIN RATE/i.test(esBody) && /NET P&L/i.test(esBody) && esBody.includes('FAIL'))
  check('authored text is byte-identical after switching to Spanish',
    (await valueOf(c, 'textarea[data-field=forecast]')) === FORECAST && (await valueOf(c, 'textarea[data-field=wentWell]')) === WENT_WELL)
  await shot(c, '08-demo-week-es')
  await nav(c, 'Settings')
  await click(c, 'button', 'English')
  await sleep(500)
  await nav(c, 'Weekly Review')
  await jumpToWeek(c, demoWeek)
  check('authored text is byte-identical after switching back to English', (await valueOf(c, 'textarea[data-field=forecast]')) === FORECAST)

  // ---- MT5 account ---------------------------------------------------------------
  check('switch to the MT5 account', await chooseAccount(c, mt5.displayName))
  await nav(c, 'Weekly Review')
  const mt5Week = weekStartOf(mt5Trades.map((t) => t.tradeDate).sort()[0])
  const mt5Weeks = [...new Set(mt5Trades.map((t) => weekStartOf(t.tradeDate)))].sort().reverse()
  const listed = (await api(c, `window.solidSkill.reviews.listWeeks(${JSON.stringify(mt5.id)})`)).data
  check('MT5 traded weeks are derived from the real imported analytical dates', JSON.stringify(listed.tradedWeeks) === JSON.stringify(mt5Weeks), `${listed.tradedWeeks} vs ${mt5Weeks}`)
  check('the demo reflection does not appear on the MT5 account (same week)',
    (await jumpToWeek(c, demoWeek)) && (await valueOf(c, 'textarea[data-field=forecast]')) === '')
  await jumpToWeek(c, mt5Week)
  const mt5WeekTrades = mt5Trades.filter((t) => weekStartOf(t.tradeDate) === mt5Week)
  check(`MT5 week ${mt5Week} lists its ${mt5WeekTrades.length} imported trades`, (await tradeRows(c)) === mt5WeekTrades.length, await tradeRows(c))
  const mt5Body = await body(c)
  check('MT5 process section states that no Strategy is assigned (nothing fabricated)', mt5Body.includes('None of this week’s Trades is associated with a Strategy') || mt5Body.includes("None of this week's Trades is associated with a Strategy"))
  check('MT5 rule review shows no evaluations', mt5Body.includes('No Rule evaluations for this week.'))
  check('MT5 R is not fabricated (no R reported)', (await c.eval(`document.querySelector('[data-section=outcome]').innerText`)).includes('No R reported'))
  check('MT5 (no Strategy): compliance bar undefined, review completion 0%',
    (await progressOf(c, 'compliance')) === '' && (await progressOf(c, 'review')) === '0', `${await progressOf(c, 'compliance')} / ${await progressOf(c, 'review')}`)
  check('MT5 (no Strategy): no process achievement earned',
    !(await earnedChips(c)).some((id) => ['tradesReviewed', 'noRuleFails', 'cleanProcess'].includes(id)), await earnedChips(c))
  check('MT5 scorecard is unrated (no leak from the demo account)', (await pressedScore(c, 'risk_management')) === null)
  await shot(c, '09-mt5-week')
  const mt5Dto = (await api(c, `window.solidSkill.reviews.getWeek({ accountId: ${JSON.stringify(mt5.id)}, weekStart: ${JSON.stringify(mt5Week)} })`)).data
  check('MT5 week facts: every trade has no Strategy and no rule results', mt5Dto.trades.every((t) => t.strategy === null) && mt5Dto.ruleResults.length === 0)
  await typeInto(c, 'textarea[data-field=notes]', 'MT5-only note')

  // ---- restart ---------------------------------------------------------------------
  await close(c)
  c = await launch()
  check('after restart the MT5 account is still active', (await triggerText(c)).startsWith(mt5.displayName))
  await nav(c, 'Weekly Review')
  await jumpToWeek(c, mt5Week)
  check('after restart the MT5 note persisted', (await valueOf(c, 'textarea[data-field=notes]')) === 'MT5-only note')
  await chooseAccount(c, demo.displayName)
  await nav(c, 'Weekly Review')
  await jumpToWeek(c, demoWeek)
  check('after restart the demo reflection persisted exactly',
    (await valueOf(c, 'textarea[data-field=forecast]')) === FORECAST && (await valueOf(c, 'textarea[data-field=wentWell]')) === WENT_WELL)
  check('after restart the demo notes field does not show the MT5 note', (await valueOf(c, 'textarea[data-field=notes]')) === '')
  check('after restart the scorecard shows the persisted scores and note',
    (await pressedScore(c, 'risk_management')) === '5' && (await pressedScore(c, 'focus')) === '2' && (await valueOf(c, 'input[data-note=discipline]')) === SCORE_NOTE)
  const authored = (await api(c, `window.solidSkill.reviews.listWeeks(${JSON.stringify(demo.id)})`)).data.authoredWeeks
  check('the week picker knows the authored demo week', authored.includes(demoWeek))
  await shot(c, '10-after-restart-demo')
  await close(c)

  // ---- integrity ---------------------------------------------------------------------
  check('no historical Trade / execution / evaluation / trade note / media / version fact changed', digest(userData, FACT_TABLES) === factsBefore)
  const dayNotesAfter = digest(userData, ['day_notes'])
  const changedNotes = dayNotesAfter.split('\n').filter((l) => !dayNotesBefore.split('\n').includes(l))
  check('only the deliberately edited Day Note changed', changedNotes.length === 1 && changedNotes[0].includes(noteDay), changedNotes.join(' | '))
  check('media files were reused, not duplicated', countFiles(join(userData, 'media')) === mediaFilesBefore, `${countFiles(join(userData, 'media'))} vs ${mediaFilesBefore}`)
  const raw = new DatabaseSync(join(userData, 'solid-skill.db'), { readOnly: true })
  const rows = raw.prepare('SELECT account_id, week_start_date FROM weekly_reviews ORDER BY 1, 2').all()
  raw.close()
  info(`weekly_reviews rows: ${JSON.stringify(rows)}`)
  check('weekly_reviews rows are keyed by (account, week start) only', rows.every((r) => r.week_start_date === weekStartOf(r.week_start_date)))
  const raw2 = new DatabaseSync(join(userData, 'solid-skill.db'), { readOnly: true })
  const scoreRows = raw2.prepare('SELECT account_id, week_start_date, dimension, score FROM weekly_scorecard_entries ORDER BY 1, 2, 3').all()
  raw2.close()
  check('scorecard rows exist only for the demo account and week', scoreRows.length > 0 && scoreRows.every((r) => r.account_id === demo.id && r.week_start_date === demoWeek), JSON.stringify(scoreRows))
  console.log(`\nweekly-review QA: ${pass} passed, ${fail} failed`)
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
