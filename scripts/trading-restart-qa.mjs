// End-to-end restart QA for persistent Trades / Executions / Reviews
// (Checkpoint 011B-2). Launches the REAL built app (`npm run build` first)
// against a throwaway --user-data-dir, drives the renderer over the Chrome
// DevTools Protocol, and closes the app GRACEFULLY between runs so every
// restart is genuine: React UI -> preload -> IPC -> main -> SQLite.
//
// Usage: node scripts/trading-restart-qa.mjs   (or npm run qa:trading-restart)
// Development tooling only; it never touches the real application database.
// Note editing has no UI yet (the screens are read-only), so notes and rule
// states are written through the real preload bridge (window.solidSkill.trades)
// and then verified in the UI after restarts.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const electronPath = createRequire(import.meta.url)('electron')
const userData = mkdtempSync(join(tmpdir(), 'solid-skill-trading-qa-'))
const shotDir = process.env.QA_SHOTS
const PORT = 9334
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${String(detail).slice(0, 600)}`}`)
}

async function json(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
  return res.json()
}

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
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
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
let logs = ''

async function launch() {
  logs = ''
  app = spawn(electronPath, [resolve('.'), `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  app.stdout.on('data', (d) => (logs += d))
  app.stderr.on('data', (d) => (logs += d))
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
  if (!target) throw new Error('renderer did not start')
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  for (let i = 0; i < 50; i += 1) {
    if (await cdp.eval('typeof window.solidSkill !== "undefined" && document.readyState === "complete"')) break
    await sleep(200)
  }
  await sleep(500)
  return cdp
}

async function close(cdp) {
  const version = await json('/json/version')
  const browser = new Cdp(version.webSocketDebuggerUrl)
  await browser.ready
  browser.send('Browser.close').catch(() => {})
  await Promise.race([app.exited, sleep(15000)])
  cdp.ws.close()
  await sleep(500)
}

// --- DOM helpers (run inside the renderer) ---------------------------------
const body = (cdp) => cdp.eval('document.body.innerText')
const clickButton = (cdp, text) =>
  cdp.eval(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)
    if (!el) return false
    el.click()
    return true
  })()`)
const clickButtonMatching = (cdp, pattern) =>
  cdp.eval(`(() => {
    const re = new RegExp(${JSON.stringify(pattern)})
    const el = [...document.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()) && !b.disabled)
    if (!el) return false
    el.click()
    return true
  })()`)
const clickTab = (cdp, text) =>
  cdp.eval(`(() => {
    const el = [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})
    if (!el) return false
    el.click(); return true
  })()`)
const clickRowContaining = (cdp, ...parts) =>
  cdp.eval(`(() => {
    const parts = ${JSON.stringify(parts)}
    const el = [...document.querySelectorAll('tbody tr')].find((r) => parts.every((p) => r.innerText.includes(p)))
    if (!el) return false
    el.click(); return true
  })()`)
const rowTexts = (cdp) => cdp.eval(`[...document.querySelectorAll('tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`)
const api = (cdp, expr) => cdp.eval(`(async () => JSON.stringify(await ${expr}))()`).then(JSON.parse)
const trades = async (cdp) => (await api(cdp, 'window.solidSkill.trades.list()')).data
const detail = async (cdp, id) => (await api(cdp, `window.solidSkill.trades.getDetail(${JSON.stringify(id)})`)).data
const strategies = async (cdp) => (await api(cdp, 'window.solidSkill.strategies.list()')).data
async function shot(cdp, name) {
  if (!shotDir) return
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.data, 'base64'))
}
async function nav(cdp, section) {
  await clickButton(cdp, section)
  await sleep(500)
}
async function goBack(cdp) {
  await clickButton(cdp, 'Back')
  await sleep(300)
}
// Navigates the Calendar workspace to a month label such as "September 2026".
async function calendarTo(cdp, label) {
  await nav(cdp, 'Calendar')
  await clickButton(cdp, 'This month')
  for (let i = 0; i < 30; i += 1) {
    if ((await body(cdp)).includes(label)) return true
    const dir = i < 15 ? 'Previous month' : 'Next month'
    if (i === 15) await clickButton(cdp, 'This month')
    await cdp.eval(`document.querySelector('[aria-label=${JSON.stringify(dir)}]')?.click()`)
    await sleep(80)
  }
  return (await body(cdp)).includes(label)
}
const populatedCalendarDays = (cdp) =>
  cdp.eval(`[...document.querySelectorAll('button')].filter((b) => !b.disabled && /^\\d+\\D*[+-]\\$/.test(b.innerText.replace(/\\s+/g, '')) && /trades?/.test(b.innerText)).map((b) => b.innerText.split('\\n')[0].trim())`)

function dbCounts() {
  const raw = new DatabaseSync(join(userData, 'solid-skill.db'), { readOnly: true })
  try {
    const out = {}
    for (const t of ['accounts', 'trades', 'executions', 'trade_notes', 'day_notes', 'trade_rule_evaluations', 'strategies', 'strategy_versions']) {
      out[t] = Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n)
    }
    return out
  } finally {
    raw.close()
  }
}

try {
  // ======================= renderer bundle carries no fixtures ===============
  const assets = join(resolve('out/renderer/assets'))
  const bundle = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n') : ''
  check('renderer bundle exists (run `npm run build` first)', bundle.length > 1000)
  check('renderer bundle contains no journal/strategy fixture data', !/Textbook entry on the reclaim|Generic description for Rule A|Slow open, waited|Best trade of the month/.test(bundle))

  // ======================= RUN 1 — baseline (clean dev DB) ===================
  let cdp = await launch()
  check('preload bridge exposes only strategies + trades + accounts', JSON.stringify(await cdp.eval('Object.keys(window.solidSkill)')) === '["strategies","trades","accounts"]')
  check('trades API exposes exactly the six application operations',
    JSON.stringify(await cdp.eval('Object.keys(window.solidSkill.trades).sort()')) ===
      JSON.stringify(['getDay', 'getDetail', 'list', 'updateDayNote', 'updateRuleEvaluation', 'updateTradeNote']))
  check('renderer has no raw ipc / require / process access',
    (await cdp.eval('typeof require + "," + typeof process + "," + typeof ipcRenderer')) === 'undefined,undefined,undefined')
  check('A first start: strategy seed then trading seed applied once',
    /development seed applied/.test(logs) && /development trading seed applied \(17 trades\)/.test(logs), logs)

  const list1 = await trades(cdp)
  const first = JSON.stringify(list1.trades.map((t) => [t.id, t.tradeDate, t.instrument, t.direction, t.netPnl]))
  check('A Journal universe: 17 persisted trades, 1 dev account', list1.trades.length === 17 && list1.accounts.length === 1 && list1.accounts[0].displayName === 'Demo Account 50K')
  const c1 = dbCounts()
  check('A row counts: 1 account, 17 trades, executions/notes/evaluations present',
    c1.accounts === 1 && c1.trades === 17 && c1.executions === 38 && c1.trade_notes === 17 && c1.day_notes === 7 && c1.trade_rule_evaluations === 83, JSON.stringify(c1))

  await nav(cdp, 'Journal')
  let text = await body(cdp)
  let rows = await rowTexts(cdp)
  check('A Journal renders the 17 persisted trades from SQLite', /17 trades/.test(text) && rows.length === 17, `${rows.length} rows; ${text.slice(0, 200)}`)
  check('A Journal shows account + strategies by persisted data', /Demo Account 50K/.test(text) && /Strategy Alpha/.test(text) && /Strategy Beta/.test(text))
  await shot(cdp, '01-journal')

  await nav(cdp, 'Dashboard')
  text = await body(cdp)
  rows = await rowTexts(cdp)
  const recent = list1.trades.slice(-6).reverse()
  check('A Dashboard Recent Trades = the 6 latest persisted trades (newest first)',
    rows.length === 6 && rows[0].includes(recent[0].instrument) && /Recent Trades/i.test(text), `${rows.length} ${JSON.stringify(rows.map((r) => r.slice(0, 30)))}`)
  await shot(cdp, '02-dashboard')

  check('A Calendar reaches September 2026', await calendarTo(cdp, 'September 2026'))
  let days = await populatedCalendarDays(cdp)
  check('A Calendar September: populated days == persisted trade dates (9), none after the 16th',
    JSON.stringify(days) === JSON.stringify(['1', '2', '4', '8', '10', '12', '14', '15', '16']), JSON.stringify(days))
  await shot(cdp, '03-calendar-sep')
  check('A Calendar August has the 3 persisted days', (await calendarTo(cdp, 'August 2026')) && (await populatedCalendarDays(cdp)).length === 3)
  await calendarTo(cdp, 'September 2026')

  // Calendar -> Day Review (Sep 15) -> Trade Review
  check('A Calendar day opens Day Review', await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && /^15\\D*[+-]\\$/.test(x.innerText.replace(/\\s+/g, '')) )
    if (!b) return false; b.click(); return true })()`))
  await sleep(500)
  text = await body(cdp)
  rows = await rowTexts(cdp)
  check('A Day Review: Sep 15, 2026, two trades chronological, Day Note from SQLite',
    /Sep 15, 2026/.test(text) && rows.length === 2 && rows[0].includes('NQ') && rows[1].includes('MNQ') && /Slow open, waited for the first real setup/.test(text), text.slice(0, 400))
  check('A Day Review compact intraday P&L present', /Intraday Cumulative Net P&L/i.test(text) && /\+\$2,002\.00/.test(text), text)
  await shot(cdp, '04-day-review')
  await clickRowContaining(cdp, 'NQ')
  await sleep(600)
  text = await body(cdp)
  check('D Trade Review from that day shows the SAME Day Note + Trade Note + siblings + Running P&L',
    /Trade Notes/i.test(text) && /Scaled in on the retest/.test(text) && /Slow open, waited for the first real setup/.test(text) && /Running P&L — Sep 15/i.test(text) && /Execution Visualization/i.test(text), text.slice(0, 500))
  await shot(cdp, '05-trade-review')
  check('G UI: LONG trade with FOUR executions (2 entries / 2 exits)', await clickTab(cdp, 'Executions'))
  await sleep(200)
  text = await body(cdp)
  rows = await rowTexts(cdp)
  check('G UI: Executions tab shows LONG, entries 2, exits 2, BUY BUY SELL SELL',
    /Trade direction\s*LONG/.test(text) && /Entries\s*2/.test(text) && /Exits\s*2/.test(text) &&
      rows.filter((r) => /BUY|SELL/.test(r)).map((r) => r.match(/BUY|SELL/)[0]).join() === 'BUY,BUY,SELL,SELL' && /09:41:13/.test(text), text.slice(0, 600))
  // sibling switch (SHORT, SELL entry then two BUY exits)
  check('H UI: switch to the SHORT sibling in place', await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('MNQ') && x.innerText.includes('13:02')); if (!b) return false; b.click(); return true })()`))
  await sleep(600)
  await clickTab(cdp, 'Executions')
  await sleep(200)
  text = await body(cdp)
  check('H UI: SHORT stays SHORT (SELL entry, BUY exits): SHORT, entries 1, exits 2', /Trade direction\s*SHORT/.test(text) && /Entries\s*1/.test(text) && /Exits\s*2/.test(text), text.slice(0, 500))
  await clickTab(cdp, 'Strategy')
  await sleep(200)
  text = await body(cdp)
  check('Trade Review Strategy tab: exact saved version v1 of Strategy Beta with its groups/rules', /Strategy Beta/.test(text) && /v1/.test(text) && /Group A/i.test(text) && /Group C/i.test(text) && /Rule E/.test(text), text.slice(0, 500))
  await goBack(cdp) // Trade Review -> Day Review (stack)
  check('Back returns to the Day Review of Sep 15', /Sep 15, 2026/.test(await body(cdp)) && /Intraday Cumulative/i.test(await body(cdp)))
  await goBack(cdp)

  // Journal quick review + Open full review
  await nav(cdp, 'Journal')
  check('A Journal quick review opens with persisted detail', await clickRowContaining(cdp, 'Sep 12', 'ES'))
  await sleep(500)
  await clickTab(cdp, 'Executions')
  await sleep(300)
  text = await body(cdp)
  check('H UI (Journal quick review): SELL entry / BUY exit trade reads SHORT', /Trade direction\s*SHORT/.test(text) && /SELL/.test(text) && /BUY/.test(text), text.slice(0, 400))
  check('Journal Open full review navigates to canonical Trade Review', await clickButton(cdp, 'Open full review'))
  await sleep(500)
  check('Canonical Trade Review opened from Journal', /Running P&L — Sep 12/i.test(await body(cdp)))
  await goBack(cdp)
  check('Back returns to the Journal with its state', /17 trades/.test(await body(cdp)))

  // Strategies -> Trades (persisted relationship, stable ids)
  await nav(cdp, 'Strategies')
  await cdp.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Strategy Alpha') && b.textContent.includes('trade'))?.click()`)
  await sleep(300)
  check('A Strategies list shows persisted trade counts (Alpha 11 / Beta 6)', /Strategy Alpha[\s\S]*?11 trades/.test(await body(cdp)) && /Strategy Beta[\s\S]*?6 trades/.test(await body(cdp)))
  await clickTab(cdp, 'Trades')
  await sleep(300)
  rows = await rowTexts(cdp)
  text = await body(cdp)
  check('A Strategies -> Trades: the 11 persisted Alpha trades, newest first, with process/outcome divergence notes',
    rows.length === 11 && /Profit with rule FAIL/.test(text) && /Loss despite 100% evaluated compliance/.test(text), `${rows.length}\n${text.slice(0, 400)}`)
  await shot(cdp, '06-strategy-trades')
  check('Strategies -> Trades row opens canonical Trade Review', await clickRowContaining(cdp, 'Sep 15'))
  await sleep(500)
  check('Trade Review reached from Strategies', /Running P&L — Sep 15/i.test(await body(cdp)))
  await goBack(cdp)

  // ---- C/D/E/F/I prep: writes through the real preload bridge --------------
  const alpha1 = (await strategies(cdp)).find((s) => s.name === 'Strategy Alpha')
  const tradeC = list1.trades.find((t) => t.tradeDate === '2026-09-15' && t.instrument === 'NQ')
  const tradeB = list1.trades.find((t) => t.tradeDate === '2026-09-12' && t.instrument === 'ES')
  const detailC1 = await detail(cdp, tradeC.id)
  check('E baseline: trade-c is on Strategy Alpha v3 (persisted ids)', detailC1.strategy.strategyId === alpha1.id && detailC1.strategy.versionNumber === 3 && detailC1.strategy.versionId === alpha1.versions[2].id)
  const noteRes = await api(cdp, `window.solidSkill.trades.updateTradeNote(${JSON.stringify({ tradeId: tradeC.id, body: 'QA trade note — survives restart' })})`)
  const dayRes = await api(cdp, `window.solidSkill.trades.updateDayNote(${JSON.stringify({ accountId: tradeC.accountId, date: '2026-09-15', body: 'QA day note — survives restart' })})`)
  check('C/D: trade note + day note written through typed IPC', noteRes.ok && dayRes.ok)
  // Rule evaluation writes on trade-b (Alpha v3, 5 rules: P F P P N/A) exercising the canonical edge cases.
  const ruleIdsB = (await detail(cdp, tradeB.id)).strategy.groups.flatMap((g) => g.rules.map((r) => r.ruleId))
  const setStates = async (states) => {
    for (let i = 0; i < ruleIdsB.length; i += 1) {
      const r = await api(cdp, `window.solidSkill.trades.updateRuleEvaluation(${JSON.stringify({ tradeId: tradeB.id, ruleId: ruleIdsB[i], state: states[i] })})`)
      if (!r.ok) throw new Error(`rule write failed: ${JSON.stringify(r)}`)
    }
  }
  const journalRowB = async () => {
    await nav(cdp, 'Dashboard')
    await nav(cdp, 'Journal') // section switch silently re-reads persisted trades
    await sleep(400)
    return (await rowTexts(cdp)).find((r) => r.includes('Sep 12') && r.includes('ES'))
  }
  const cases = [
    { name: 'Pass only', states: ['Pass', 'Pass', 'Pass', 'Pass', 'Pass'], expect: /100%\s*·\s*Complete/ },
    { name: 'Pass + Unreviewed', states: ['Pass', 'Pass', 'Unreviewed', 'Unreviewed', 'Unreviewed'], expect: /100%\s*·\s*Incomplete/ },
    { name: 'only Unreviewed', states: Array(5).fill('Unreviewed'), expect: /—\s*·\s*Incomplete/ },
    { name: 'only N/A', states: Array(5).fill('N/A'), expect: /—\s*·\s*Complete/ },
    { name: '3P/1F/1NA (seeded shape, 1 fail + N/A)', states: ['Pass', 'Fail', 'Pass', 'Pass', 'N/A'], expect: /75%\s*·\s*Complete/ }
  ]
  for (const c of cases) {
    await setStates(c.states)
    const row = await journalRowB()
    check(`I compliance in the UI after persisted write: ${c.name}`, c.expect.test(row ?? ''), row)
  }
  // Leave trade-b with Pass, Unreviewed x4 -> persisted as "100% · Incomplete" to verify after restart.
  await setStates(['Pass', 'Unreviewed', 'Unreviewed', 'Unreviewed', 'Unreviewed'])
  // A rule of Strategy Beta v1 offered for an Alpha v3 trade must be refused.
  const tradeD = list1.trades.find((t) => t.tradeDate === '2026-09-15' && t.instrument === 'MNQ')
  const betaRule = (await detail(cdp, tradeD.id)).strategy.groups[0].rules[0].ruleId
  const wrong = await api(cdp, `window.solidSkill.trades.updateRuleEvaluation(${JSON.stringify({ tradeId: tradeC.id, ruleId: betaRule, state: 'Pass' })})`)
  check('rule write for a rule of ANOTHER trade/version is refused (RULE_VIOLATION)', wrong.ok === false && wrong.error.code === 'RULE_VIOLATION', JSON.stringify(wrong))
  await close(cdp)

  // ======================= RUN 2 — second start ==============================
  cdp = await launch()
  check('B second start: no migration, no seed re-applied', /migrations applied this start: none/.test(logs) && !/development seed applied/.test(logs) && !/development trading seed applied/.test(logs), logs)
  const c2 = dbCounts()
  check('B no duplicate accounts/trades/executions/notes/evaluations after restart', JSON.stringify(c2) === JSON.stringify(c1), `${JSON.stringify(c1)} vs ${JSON.stringify(c2)}`)
  const list2 = await trades(cdp)
  check('B same 17 trades with the same ids', list2.trades.length === 17 && JSON.stringify(list2.trades.map((t) => [t.id, t.tradeDate, t.instrument, t.direction, t.netPnl])) === first)
  const detailC2 = await detail(cdp, tradeC.id)
  check('C Trade Note persisted across restart', detailC2.tradeNote === 'QA trade note — survives restart')
  check('D Day Note persisted across restart and is the same from the trade', detailC2.dayNote === 'QA day note — survives restart')
  const rulesB2 = (await detail(cdp, tradeB.id)).trade.compliance
  check('I persisted rule states survive restart (1P, 4U)', rulesB2.pass === 1 && rulesB2.unreviewed === 4 && rulesB2.fail === 0 && rulesB2.na === 0, JSON.stringify(rulesB2))
  await calendarTo(cdp, 'September 2026')
  await cdp.eval(`[...document.querySelectorAll('button')].find((x) => !x.disabled && /^15\\D*[+-]\\$/.test(x.innerText.replace(/\\s+/g, '')))?.click()`)
  await sleep(500)
  check('D Day Review shows the edited Day Note after restart', /QA day note — survives restart/.test(await body(cdp)))
  await clickRowContaining(cdp, 'NQ')
  await sleep(600)
  text = await body(cdp)
  check('C/D Trade Review shows edited Trade Note and Day Note after restart', /QA trade note — survives restart/.test(text) && /QA day note — survives restart/.test(text), text.slice(0, 500))
  await shot(cdp, '07-notes-after-restart')

  // E: rename Alpha (metadata only), through the strategies API
  const rename = await api(cdp, `window.solidSkill.strategies.updateDetails(${JSON.stringify({ strategyId: alpha1.id, name: 'Opening Model', description: alpha1.description })})`)
  check('E Strategy Alpha renamed to "Opening Model"', rename.ok && rename.data.name === 'Opening Model')
  await close(cdp)

  // ======================= RUN 3 — rename stability ==========================
  cdp = await launch()
  const detailC3 = await detail(cdp, tradeC.id)
  check('E after rename + restart: same stable Strategy id, same exact v3 version id, new display name',
    detailC3.strategy.strategyId === alpha1.id && detailC3.strategy.versionId === detailC1.strategy.versionId && detailC3.strategy.versionNumber === 3 && detailC3.strategy.strategyName === 'Opening Model')
  check('E v3 rule evaluations unchanged by the rename', JSON.stringify(detailC3.strategy.groups) === JSON.stringify(detailC1.strategy.groups))
  await nav(cdp, 'Strategies')
  await cdp.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Opening Model') && b.textContent.includes('trade'))?.click()`)
  await sleep(300)
  await clickTab(cdp, 'Trades')
  await sleep(300)
  rows = await rowTexts(cdp)
  check('E Strategies -> Trades still contains all 11 trades under the new name', rows.length === 11, `${rows.length}`)
  await clickRowContaining(cdp, 'Sep 15')
  await sleep(500)
  await clickTab(cdp, 'Strategy')
  await sleep(200)
  text = await body(cdp)
  check('E Trade Review renders the correct historical version (Opening Model v3, Rules A-E)', /Opening Model/.test(text) && /v3/.test(text) && /Rule A/.test(text) && /Rule E/.test(text) && /Saved version at time of evaluation/.test(text), text.slice(0, 500))
  await shot(cdp, '08-renamed-trade-review')
  await goBack(cdp)

  // F: publish v4 of the renamed strategy
  const begin = await api(cdp, `window.solidSkill.strategies.beginDraft(${JSON.stringify(alpha1.id)})`)
  const draftRule = begin.data.draft.groups[0].rules[0]
  await api(cdp, `window.solidSkill.strategies.editDraft(${JSON.stringify({ strategyId: alpha1.id, edit: { type: 'updateRule', ruleId: draftRule.id, name: draftRule.name, kind: draftRule.kind, description: 'Rule A rewritten for v4' } })})`)
  const published = await api(cdp, `window.solidSkill.strategies.publishDraft(${JSON.stringify(alpha1.id)})`)
  check('F v4 published', published.ok && published.data.versions.map((v) => v.number).join() === '1,2,3,4')
  await close(cdp)

  // ======================= RUN 4 — newer version stability ===================
  cdp = await launch()
  const detailC4 = await detail(cdp, tradeC.id)
  check('F T1 remains on v3 (same version id) after v4 exists', detailC4.strategy.versionNumber === 3 && detailC4.strategy.versionId === detailC1.strategy.versionId)
  check('F v3 rule evaluations unchanged after v4', JSON.stringify(detailC4.strategy.groups) === JSON.stringify(detailC1.strategy.groups))
  const list4 = await trades(cdp)
  check('F no trade moved to v4', list4.trades.every((t) => t.strategy.versionNumber !== 4))
  await nav(cdp, 'Strategies')
  await cdp.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Opening Model') && b.textContent.includes('trade'))?.click()`)
  await sleep(300)
  await clickTab(cdp, 'Versions')
  await sleep(300)
  check('F Versions tab lists v4 current with v3 historical and per-version trade counts from persisted ids', /v4\s*Current/.test(await body(cdp)))
  await clickButtonMatching(cdp, '^v3')
  await sleep(200)
  check('F v3 shows a persisted per-version trade count', /\d+ trades on this version/.test(await body(cdp)))
  await clickTab(cdp, 'Trades')
  await sleep(300)
  text = await body(cdp)
  check('F Strategies -> Trades marks v3 trades as saved (not current)', (await rowTexts(cdp)).length === 11 && /saved/.test(text))
  await close(cdp)

  // ======================= J: persistence failure =============================
  rmSync(join(userData, 'solid-skill.db-wal'), { force: true })
  rmSync(join(userData, 'solid-skill.db-shm'), { force: true })
  writeFileSync(join(userData, 'solid-skill.db'), 'this is not a sqlite database'.repeat(50))
  cdp = await launch()
  check('J failure logged; app still starts', /failed to initialize database/.test(logs))
  for (const section of ['Journal', 'Dashboard', 'Calendar']) {
    await nav(cdp, section)
    await sleep(400)
    text = await body(cdp)
    check(`J ${section}: visible controlled error, no fixture/fake trades`,
      /(Trades|Accounts) could not be loaded/.test(text) && !/Demo Account|Strategy Alpha|Opening Model|NQ|MNQ/.test(text), text.slice(0, 300))
  }
  await nav(cdp, 'Strategies')
  text = await body(cdp)
  check('J Strategies: error state, not fixtures', /Strategies could not be loaded/.test(text) && !/Strategy Alpha/.test(text))
  const down = await api(cdp, 'window.solidSkill.trades.list()')
  check('J IPC reports PERSISTENCE_UNAVAILABLE for trades', down.ok === false && down.error.code === 'PERSISTENCE_UNAVAILABLE', JSON.stringify(down))
  await shot(cdp, '09-persistence-error')
  await close(cdp)
} catch (error) {
  fail += 1
  console.log('FAIL  QA aborted:', error?.stack ?? error)
  console.log(logs)
} finally {
  try {
    app?.kill()
  } catch {
    /* already exited */
  }
  await sleep(500)
  rmSync(userData, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
