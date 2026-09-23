// Strategy Assignment + Strategy list ordering real-app QA (Checkpoint 015B).
// Launches the REAL built app (`npm run build` first) against a THROWAWAY COPY
// of the solid-skill-dev database + media folder, so real development data
// (incl. imported MT5 Trade facts) is never opened for writing. The real dev
// database is fingerprinted before and after and must be byte-identical.
// Drives the renderer over the Chrome DevTools Protocol:
//   - Strategies: Move up / Move down menu, drag/drop reorder, top/bottom
//     limits, no Draft / Version created, order survives restart
//   - Trade Review (MT5 account, on the COPY): unassigned Trade shows Assign
//     Strategy; picker lists published Strategies with exact Versions; archived
//     hidden by default; a HISTORICAL version is assigned explicitly; rules
//     start UNREVIEWED; PASS / FAIL / N/A through the evaluation control;
//     compliance updates; states persist across restart; active account kept
//   - Weekly Review reflects the new evaluations from persisted data
//   - integrity: only the target Trade's strategy_version_id + new evaluation
//     rows changed; no Trade fact, execution, note, media, version or rule did
// Usage: node scripts/strategy-assignment-qa.mjs   (QA_SHOTS=<dir> saves screenshots)
// Development tooling only.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const electronPath = createRequire(import.meta.url)('electron')
const source = process.env.QA_SOURCE ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'solid-skill-dev')
const userData = mkdtempSync(join(tmpdir(), 'solid-skill-assign-qa-'))
const shotDir = process.env.QA_SHOTS
if (shotDir) mkdirSync(shotDir, { recursive: true })
const PORT = 9343
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${String(detail).slice(0, 500)}`}`)
}
const info = (line) => console.log(`INFO  ${line}`)

const sha = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent')
const realDb = join(source, 'solid-skill.db')
const realBefore = sha(realDb)

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
const weekStartOf = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}
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

// ---- DB helpers (the COPY, read-only) ---------------------------------------
function rows(sql, params = []) {
  const raw = new DatabaseSync(join(userData, 'solid-skill.db'), { readOnly: true })
  try {
    return raw.prepare(sql).all(...params)
  } finally {
    raw.close()
  }
}
const ser = (r) => JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
const digest = (tables) => tables.map((t) => ser(rows(`SELECT * FROM ${t} ORDER BY 1`))).join('\n---\n')
/** Every trade column except the two assignment may write (strategy_version_id, updated_at). */
const tradeFacts = () =>
  ser(rows('SELECT * FROM trades ORDER BY id').map(({ strategy_version_id: _v, updated_at: _u, ...facts }) => facts))

// ---- Strategies list helpers --------------------------------------------------
const domActiveOrder = (c, activeIds) =>
  c.eval(`[...document.querySelectorAll('[data-strategy-id]')].map((e) => e.getAttribute('data-strategy-id')).filter((id) => ${JSON.stringify(activeIds)}.includes(id))`)
async function menuMove(c, strategyId, label) {
  await c.eval(`document.querySelector('[data-strategy-id="${strategyId}"] button[aria-haspopup=menu]').click()`)
  await sleep(150)
  const disabled = await c.eval(
    `[...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.disabled ?? null`
  )
  if (disabled === false) await click(c, '[role=menuitem]', label)
  else await c.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(700)
  return disabled
}
async function dragOnto(c, fromId, toId, after) {
  return c.eval(`(() => {
    const from = document.querySelector('[data-strategy-id="${fromId}"]')
    const to = document.querySelector('[data-strategy-id="${toId}"]')
    if (!from || !to) return false
    const dt = new DataTransfer()
    const r = to.getBoundingClientRect()
    const y = ${after ? 'r.bottom - 2' : 'r.top + 2'}
    const wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
    return (async () => {
      // Real drags leave frames between these events; mirror that.
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      await wait(50)
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y })
      to.dispatchEvent(over)
      if (!over.defaultPrevented) return 'not-accepted'
      await wait(50)
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }))
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      return true
    })()
  })()`)
}

// ---- Trade Review helpers -------------------------------------------------------
async function openTradeFromJournal(c, tradeId) {
  await nav(c, 'Journal')
  const ok = await c.eval(`(() => {
    const row = document.querySelector('tr[data-trade-id="${tradeId}"]')
    if (!row) return false
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return true
  })()`)
  await sleep(900)
  return ok
}
async function openTab(c, name) {
  await click(c, '[role=tab]', name)
  await sleep(300)
}
const ruleStates = (c) =>
  c.eval(`[...document.querySelectorAll('[data-rule-id]')].map((r) => ({
    id: r.getAttribute('data-rule-id'),
    state: r.querySelector('[role=radio][aria-checked=true]')?.getAttribute('data-state') ?? null
  }))`)
async function setRule(c, ruleId, state) {
  await c.eval(`document.querySelector('[data-rule-id="${ruleId}"] [data-state="${state}"]').click()`)
  await sleep(700)
}

try {
  const factsBefore = tradeFacts()
  const logicBefore = digest(['strategy_versions', 'rule_groups', 'rules'])
  const sideBefore = digest(['executions', 'trade_notes', 'day_notes', 'trade_media', 'weekly_reviews', 'weekly_scorecard_entries'])
  const evalsBefore = rows('SELECT * FROM trade_rule_evaluations ORDER BY id')

  let c = await launch()
  const migrations = rows('SELECT version FROM schema_migrations ORDER BY version').map((r) => Number(r.version))
  check('the copy was upgraded to migration 006 on launch', migrations.at(-1) === 6, migrations)

  // =========================== STRATEGIES ORDERING ===========================
  await nav(c, 'Strategies')
  let list = (await api(c, 'window.solidSkill.strategies.list()')).data
  const activeIds = () => list.filter((s) => s.status === 'Active').sort((a, b) => a.position - b.position).map((s) => s.id)
  const nameOf = (id) => list.find((s) => s.id === id)?.name
  let expected = activeIds()
  const draftsBefore = ser(list.filter((s) => s.draft !== null).map((s) => s.id).sort())
  info(`initial Active order: ${expected.map(nameOf).join(' | ')}`)
  check('Active list renders in persisted position order', ser(await domActiveOrder(c, expected)) === ser(expected))
  check('there are at least 3 Active strategies to reorder', expected.length >= 3, expected.length)
  await shot(c, '01-strategies-initial')

  const top = expected[0]
  const bottom = expected.at(-1)
  check('top item: Move up is disabled', (await menuMove(c, top, 'Move up')) === true)
  check('bottom item: Move down is disabled', (await menuMove(c, bottom, 'Move down')) === true)

  check('Move up (menu) on the bottom item is enabled', (await menuMove(c, bottom, 'Move up')) === false)
  expected = [...expected.slice(0, -2), expected.at(-1), expected.at(-2)]
  check('Move up swapped the last two rows', ser(await domActiveOrder(c, expected)) === ser(expected), (await domActiveOrder(c, expected)).map(nameOf))

  const moveDownId = expected[0]
  await menuMove(c, moveDownId, 'Move down')
  expected = [expected[1], expected[0], ...expected.slice(2)]
  check('Move down (menu) moved the first row one down', ser(await domActiveOrder(c, expected)) === ser(expected))

  check('a row of the same section accepts the drag', (await dragOnto(c, expected[0], expected.at(-1), true)) === true)
  await sleep(800)
  expected = [...expected.slice(1), expected[0]]
  check('drag/drop moved the first row to the bottom', ser(await domActiveOrder(c, expected)) === ser(expected), (await domActiveOrder(c, expected)).map(nameOf))
  await shot(c, '02-strategies-reordered')
  if (shotDir) {
    const mid = await c.eval(`document.querySelector('[data-strategy-id="${expected[1]}"]').getBoundingClientRect().toJSON()`)
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid.x + 40, y: mid.y + 10 })
    await c.eval(`document.querySelector('[data-strategy-id="${expected[1]}"] button[aria-haspopup=menu]').click()`)
    await sleep(250)
    await shot(c, '02b-row-menu-open')
    await c.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await sleep(150)
  }

  const archivedRow = list.find((s) => s.status === 'Archived')
  if (archivedRow) {
    const result = await dragOnto(c, archivedRow.id, expected[0], false)
    await sleep(600)
    const after = (await api(c, 'window.solidSkill.strategies.list()')).data.find((s) => s.id === archivedRow.id)
    check('an Archived row cannot be dropped into Active (no implicit restore)', result === 'not-accepted' && after.status === 'Archived', result)
  }

  list = (await api(c, 'window.solidSkill.strategies.list()')).data
  check('persisted positions match the displayed order', ser(activeIds()) === ser(expected))
  check('reordering created no Draft', ser(list.filter((s) => s.draft !== null).map((s) => s.id).sort()) === draftsBefore)
  check('reordering created no Version / changed no Group or Rule', digest(['strategy_versions', 'rule_groups', 'rules']) === logicBefore)

  await close(c)
  c = await launch()
  await nav(c, 'Strategies')
  check('manual order preserved after restart', ser(await domActiveOrder(c, expected)) === ser(expected), (await domActiveOrder(c, expected)).map(nameOf))
  await shot(c, '03-strategies-after-restart')

  // =========================== TRADE ASSIGNMENT ===========================
  const accounts = (await api(c, 'window.solidSkill.accounts.list()')).data.accounts
  const mt5 = accounts.find((a) => a.displayName.startsWith('MT5'))
  check('the copy has an MT5 account', Boolean(mt5), accounts.map((a) => a.displayName))
  if (!(await triggerText(c)).startsWith(mt5.displayName)) await chooseAccount(c, mt5.displayName)
  const activeBefore = (await api(c, 'window.solidSkill.accounts.list()')).data.activeAccountId
  const all = (await api(c, 'window.solidSkill.trades.list()')).data.trades
  const target = all.filter((t) => t.accountId === mt5.id && t.strategy === null).at(-1)
  check('an unassigned MT5 Trade exists in the copy', Boolean(target))
  info(`target (copy only): ${target.instrument} ${target.tradeDate}`)

  check('Journal row opens the full Trade Review', await openTradeFromJournal(c, target.id))
  check('Trade Review is shown', (await c.eval(`document.querySelector('h1')?.innerText`)) === 'Trade Review')
  await openTab(c, 'Strategy')
  let text = await body(c)
  check('Strategy tab explains there is no Strategy and offers Assign Strategy',
    text.includes('This Trade is not associated with a Strategy.') && (await c.eval(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Assign Strategy')`)))
  await shot(c, '04-strategy-tab-unassigned')

  await click(c, 'button', 'Assign Strategy')
  await sleep(700)
  check('assignment dialog opened', await c.eval(`Boolean(document.querySelector('[role=dialog][aria-modal=true]'))`))
  const published = list.filter((s) => s.versions.length > 0)
  const optionNames = () => c.eval(`[...document.querySelectorAll('[role=dialog] [role=radiogroup]')[0].querySelectorAll('[role=radio]')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`)
  let options = await optionNames()
  const activePublished = published.filter((s) => s.status === 'Active')
  const archivedPublished = published.filter((s) => s.status === 'Archived')
  check('picker lists every Active published Strategy (with its current version) and hides archived ones',
    activePublished.every((s) => options.some((o) => o.startsWith(s.name) && o.endsWith(`v${s.versions.at(-1).number}`))) &&
      archivedPublished.every((s) => !options.some((o) => o.startsWith(s.name))),
    options)
  if (archivedPublished.length > 0) {
    await click(c, '[role=dialog] button', 'Show archived Strategies')
    await sleep(200)
    options = await optionNames()
    check('archived Strategies are reachable on request (marked Archived)', archivedPublished.every((s) => options.some((o) => o.startsWith(s.name) && o.includes('Archived'))), options)
    await click(c, '[role=dialog] button', 'Hide archived Strategies')
    await sleep(200)
  }
  check('Assign is disabled until an exact version is selected', await c.eval(`[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Assign')?.disabled === true`))

  // A generic dev-seed Strategy with several versions (never the user's own methodology).
  const alpha = published.find((s) => s.name === 'Strategy Alpha' && s.versions.length >= 2)
  check('Strategy Alpha (dev seed, ≥2 versions) is available in the copy', Boolean(alpha))
  await click(c, '[role=dialog] [role=radio]', 'Strategy Alpha')
  await sleep(200)
  const versionRows = await c.eval(`[...document.querySelectorAll('[role=dialog] [role=radiogroup]')[1].querySelectorAll('[role=radio]')].map((b) => ({ id: b.getAttribute('data-version-id'), text: b.innerText.replace(/\\s+/g, ' ').trim(), checked: b.getAttribute('aria-checked') === 'true' }))`)
  const current = alpha.versions.at(-1)
  const historical = alpha.versions.at(-2)
  check('versions listed newest first with Current / Historical labels', versionRows[0].text.startsWith(`v${current.number} Current`) && versionRows.slice(1).every((v) => v.text.includes('Historical')), versionRows.map((v) => v.text))
  check('the current version is preselected', versionRows[0].checked && versionRows[0].id === current.id)
  text = await body(c)
  check('confirmation names the exact current version', text.includes(`Assign Strategy Alpha · v${current.number} to this Trade?`))

  await c.eval(`document.querySelector('[role=dialog] [data-version-id="${historical.id}"]').click()`)
  await sleep(200)
  text = await body(c)
  const historicalRules = historical.groups.reduce((n, g) => n + g.rules.length, 0)
  check('selecting a historical version updates the confirmation to that exact version',
    text.includes(`Assign Strategy Alpha · v${historical.number} to this Trade?`) &&
      text.includes(`This creates ${historicalRules} UNREVIEWED evaluations for the rules in v${historical.number}.`) &&
      text.includes(`A newer version (v${current.number}) exists.`))
  await shot(c, '05-assign-dialog-historical')

  await click(c, '[role=dialog] button', 'Assign')
  await sleep(1200)
  check('dialog closed after assignment', !(await c.eval(`Boolean(document.querySelector('[role=dialog][aria-modal=true]'))`)))
  text = await body(c)
  check('Strategy tab now shows the exact Strategy and version', text.includes('Strategy Alpha') && (await c.eval(`[...document.querySelectorAll('span')].some((s) => s.textContent.trim() === 'v${historical.number}')`)))
  let states = await ruleStates(c)
  check(`every rule of v${historical.number} is shown and starts UNREVIEWED`, states.length === historicalRules && states.every((s) => s.state === 'Unreviewed'), states)
  check('group names come from the assigned version', historical.groups.every((g) => text.includes(g.name.toUpperCase()) || text.includes(g.name)))
  check('Review: Incomplete while UNREVIEWED remain', text.includes('Review: Incomplete'))
  await shot(c, '06-assigned-unreviewed')

  const dbTrade = rows('SELECT strategy_version_id FROM trades WHERE id = ?', [target.id])[0]
  check('persisted association is the exact historical version id', dbTrade.strategy_version_id === historical.id)

  await setRule(c, states[0].id, 'Pass')
  await setRule(c, states[1].id, 'Fail')
  if (states.length > 2) await setRule(c, states[2].id, 'N/A')
  states = await ruleStates(c)
  check('PASS / FAIL / N/A shown after clicking', states[0].state === 'Pass' && states[1].state === 'Fail' && (states.length < 3 || states[2].state === 'N/A'), states)
  text = await body(c)
  check('compliance updates to 50% (1 PASS / (1 PASS + 1 FAIL)), N/A excluded', text.includes('50%') && text.includes('1 of 2 evaluated'), text.slice(0, 400))
  const detail = (await api(c, `window.solidSkill.trades.getDetail(${JSON.stringify(target.id)})`)).data
  check('persisted counts match', ser(detail.trade.compliance) === ser({ pass: 1, fail: 1, na: states.length > 2 ? 1 : 0, unreviewed: states.length - (states.length > 2 ? 3 : 2) }), detail.trade.compliance)
  await setRule(c, states[1].id, 'Unreviewed')
  await setRule(c, states[1].id, 'Fail')
  check('UNREVIEWED reset and back to FAIL works', (await ruleStates(c))[1].state === 'Fail')
  await shot(c, '07-evaluated')

  await click(c, 'button', 'Back')
  await sleep(800)
  check('Back returns with the MT5 account still active', (await triggerText(c)).startsWith(mt5.displayName) && (await api(c, 'window.solidSkill.accounts.list()')).data.activeAccountId === activeBefore)

  // =========================== WEEKLY REVIEW ===========================
  await nav(c, 'Weekly Review')
  const week = weekStartOf(target.tradeDate)
  check('Weekly Review can show the target week', await jumpToWeek(c, week))
  const weekTrades = (await api(c, `window.solidSkill.trades.list()`)).data.trades.filter((t) => t.accountId === mt5.id && weekStartOf(t.tradeDate) === week)
  const withStrategy = weekTrades.filter((t) => t.strategy !== null)
  const pooled = withStrategy.reduce((a, t) => ({ pass: a.pass + t.compliance.pass, fail: a.fail + t.compliance.fail }), { pass: 0, fail: 0 })
  const expectedCompliance = pooled.pass + pooled.fail === 0 ? '' : String(Math.round((pooled.pass / (pooled.pass + pooled.fail)) * 100))
  const shownCompliance = await c.eval(`document.querySelector('[data-progress=compliance]')?.getAttribute('data-percent') ?? null`)
  check('Weekly Review process compliance reflects the new evaluations', shownCompliance === expectedCompliance && expectedCompliance === '50', `${shownCompliance} vs ${expectedCompliance}`)
  const rulesText = await c.eval(`document.querySelector('[data-section=rules]')?.innerText ?? ''`)
  check('Weekly Review rule review shows the exact Strategy · version', rulesText.includes('Strategy Alpha') && rulesText.includes(`v${historical.number}`), rulesText.slice(0, 300))
  await shot(c, '08-weekly-review')

  // =========================== RESTART PERSISTENCE ===========================
  await close(c)
  c = await launch()
  check('after restart the MT5 account is still active', (await triggerText(c)).startsWith(mt5.displayName))
  await openTradeFromJournal(c, target.id)
  await openTab(c, 'Strategy')
  const after = await ruleStates(c)
  check('rule states persisted across restart', after[0].state === 'Pass' && after[1].state === 'Fail' && (after.length < 3 || after[2].state === 'N/A') && after.slice(3).every((s) => s.state === 'Unreviewed'), after)
  check('no Assign Strategy action on an assigned Trade (no casual reassignment)', !(await c.eval(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Assign Strategy')`)))
  await close(c)

  // =========================== INTEGRITY ===========================
  check('no Trade fact changed (every trade column except strategy_version_id / updated_at)', tradeFacts() === factsBefore)
  const assignedNow = rows('SELECT id FROM trades WHERE strategy_version_id IS NOT NULL ORDER BY id').map((r) => r.id)
  const assignedBefore = new Set(evalsBefore.map((e) => e.trade_id))
  check('only the target Trade gained an association', assignedNow.filter((id) => !assignedBefore.has(id)).join() === target.id, assignedNow.length)
  check('executions, notes, media, weekly reviews unchanged', digest(['executions', 'trade_notes', 'day_notes', 'trade_media', 'weekly_reviews', 'weekly_scorecard_entries']) === sideBefore)
  check('versions / groups / rules unchanged', digest(['strategy_versions', 'rule_groups', 'rules']) === logicBefore)
  const evalsAfter = rows('SELECT * FROM trade_rule_evaluations ORDER BY id')
  const oldUntouched = evalsBefore.every((e) => ser(evalsAfter.find((x) => x.id === e.id)) === ser(e))
  const added = evalsAfter.filter((e) => !evalsBefore.some((x) => x.id === e.id))
  check('pre-existing evaluations untouched; new rows only for the target Trade and its exact version',
    oldUntouched && added.length === historicalRules && added.every((e) => e.trade_id === target.id && e.strategy_version_id === historical.id))
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
check('the real development database was never written (byte-identical)', sha(realDb) === realBefore)
console.log(`\nstrategy-assignment QA: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
