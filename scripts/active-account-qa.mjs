// Active-account QA (Checkpoint 012B-3). Launches the REAL built app
// (`npm run build` first) against a THROWAWAY COPY of the solid-skill-dev
// database, so the real development data is never opened for writing. Drives
// the renderer over the Chrome DevTools Protocol: selects accounts through the
// Topbar control and reads what Journal / Calendar / Day Review show.
// Usage: node scripts/active-account-qa.mjs   (QA_SHOTS=<dir> saves screenshots)
// Development tooling only.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const electronPath = createRequire(import.meta.url)('electron')
const source = process.env.QA_SOURCE ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'solid-skill-dev')
const userData = mkdtempSync(join(tmpdir(), 'solid-skill-account-qa-'))
const shotDir = process.env.QA_SHOTS
if (shotDir) mkdirSync(shotDir, { recursive: true })
const PORT = 9337
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
    } && !b.disabled)
    if (!el) return false
    el.click()
    return true
  })()`)
const clickButton = (c, text) => click(c, 'button', text)
const rows = (c) => c.eval(`[...document.querySelectorAll('tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`)
const triggerText = (c) =>
  c.eval(`(document.querySelector('button[aria-haspopup=listbox]')?.innerText ?? '').replace(/\\s+/g, ' ').trim()`)
async function shot(c, name) {
  if (!shotDir) return
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.data, 'base64'))
}
async function chooseAccount(c, label) {
  await click(c, 'button[aria-haspopup=listbox]')
  await sleep(150)
  const ok = await click(c, '[role=option] button', label)
  await sleep(700)
  return ok
}
const api = (c, expr) => c.eval(`(async () => JSON.stringify(await ${expr}))()`).then(JSON.parse)
async function nav(c, section) {
  await clickButton(c, section)
  await sleep(600)
}

function factsDigest(dir) {
  const raw = new DatabaseSync(join(dir, 'solid-skill.db'), { readOnly: true })
  try {
    return ['trades', 'executions', 'trade_rule_evaluations', 'trade_notes', 'day_notes']
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

try {
  const before = factsDigest(userData)
  let c = await launch()
  const list = (await api(c, 'window.solidSkill.accounts.list()')).data
  const names = list.accounts.map((a) => a.displayName)
  info(`accounts: ${JSON.stringify(names)} active=${list.activeAccountId}`)
  check('accounts API is exposed and lists Demo Account 50K + an MT5 account',
    names.includes('Demo Account 50K') && names.some((n) => /^MT5 · \*\*\*\d+$/.test(n)))
  check('accounts DTO carries only id/displayName/currency/timezone',
    list.accounts.every((a) => JSON.stringify(Object.keys(a).sort()) === '["currency","displayName","id","timezone"]'))
  const mt5 = list.accounts.find((a) => a.displayName.startsWith('MT5'))
  const demo = list.accounts.find((a) => a.displayName === 'Demo Account 50K')
  const all = (await api(c, 'window.solidSkill.trades.list()')).data
  const mt5Trades = all.trades.filter((t) => t.accountId === mt5.id)
  const demoTrades = all.trades.filter((t) => t.accountId === demo.id)

  await nav(c, 'Journal')
  await shot(c, '01-initial-journal')
  check('first run (no preference) uses the first account (demo)',
    (await triggerText(c)).startsWith('Demo Account 50K') && (await rows(c)).length === demoTrades.length)

  // ---- demo -> MT5 ----
  await click(c, 'button[aria-haspopup=listbox]')
  await sleep(200)
  await shot(c, '02-dropdown-open')
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(200)
  check('Escape closes the dropdown', !(await c.eval(`!!document.querySelector('[role=listbox]')`)))
  check('select MT5 account in the Topbar', await chooseAccount(c, mt5.displayName))
  const r1 = await rows(c)
  await shot(c, '03-journal-mt5')
  check(`Journal shows the MT5 account's trades (${mt5Trades.length})`, r1.length === mt5Trades.length && mt5Trades.length > 0, `${r1.length}`)
  const dirs = { Long: 0, Short: 0 }
  for (const t of mt5Trades) dirs[t.direction] += 1
  info(`MT5 journal rows=${r1.length} directions=${JSON.stringify(dirs)} symbols=${JSON.stringify([...new Set(mt5Trades.map((t) => t.instrument))])}`)
  check('selector reflects MT5', (await triggerText(c)).startsWith(mt5.displayName))

  await nav(c, 'Calendar')
  await clickButton(c, 'This month')
  await sleep(300)
  await shot(c, '04-calendar-mt5')
  const dates = [...new Set(mt5Trades.map((t) => t.tradeDate))].sort()
  info(`MT5 analytical dates: ${dates[0]} .. ${dates[dates.length - 1]} (${dates.length} distinct days)`)
  const populated = await c.eval(
    `[...document.querySelectorAll('button')].filter((b) => !b.disabled && /trades?/.test(b.innerText) && /^\\d+/.test(b.innerText.trim())).length`
  )
  info(`Calendar populated day cells in the displayed month: ${populated}`)
  check('Calendar shows populated days for the MT5 account', populated > 0)

  const dayBtn = await c.eval(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && /trades?/.test(x.innerText) && /^\\d+/.test(x.innerText.trim())); if (!b) return false; b.click(); return true })()`
  )
  await sleep(700)
  const dayBody = await body(c)
  check('Day Review opens for an MT5 day and names the MT5 account', dayBtn && dayBody.includes(mt5.displayName), dayBody.slice(0, 200))
  await shot(c, '05-day-review-mt5')
  const openTrade = await c.eval(
    `(() => { const r = document.querySelector('tbody tr'); if (!r) return false; r.click(); return true })()`
  )
  await sleep(700)
  info(`trade opened from Day Review: ${openTrade}; Trade Review title shown: ${(await c.eval(`document.querySelector('h1')?.innerText`)) === 'Trade Review'}`)
  await shot(c, '06-trade-review-mt5')
  check('Trade Review opens from Day Review and the selector stays MT5',
    openTrade && (await c.eval(`document.querySelector('h1')?.innerText`)) === 'Trade Review' && (await triggerText(c)).startsWith(mt5.displayName))

  // ---- MT5 -> demo, from inside an overlay ----
  check('select Demo from inside an overlay', await chooseAccount(c, 'Demo Account 50K'))
  check('overlay closed on account switch', !/Review/.test(await c.eval(`document.querySelector('h1')?.innerText`)))
  await nav(c, 'Journal')
  const r2 = await rows(c)
  await shot(c, '07-journal-demo-again')
  check(`Journal shows the demo trades again (${demoTrades.length})`, r2.length === demoTrades.length, `${r2.length}`)
  await nav(c, 'Calendar')
  await shot(c, '08-calendar-demo')

  // ---- rapid switching ----
  for (const n of [mt5.displayName, demo.displayName, mt5.displayName]) {
    await click(c, 'button[aria-haspopup=listbox]')
    await sleep(60)
    await click(c, '[role=option] button', n)
    await sleep(60)
  }
  await sleep(900)
  await nav(c, 'Journal')
  check('after rapid switching the final choice wins (MT5)',
    (await triggerText(c)).startsWith(mt5.displayName) && (await rows(c)).length === mt5Trades.length)

  await nav(c, 'Dashboard')
  await shot(c, '09-dashboard-mt5')
  await nav(c, 'Strategies')
  await shot(c, '10-strategies')
  check('Strategies still loads', (await body(c)).length > 50)

  // ---- restart persistence ----
  await close(c)
  c = await launch()
  await nav(c, 'Journal')
  check('after restart the MT5 selection is remembered',
    (await triggerText(c)).startsWith(mt5.displayName) && (await rows(c)).length === mt5Trades.length)
  await shot(c, '11-after-restart')
  await close(c)

  check('no historical Trade fact changed in the QA copy', factsDigest(userData) === before)
  console.log(`\nactive-account QA: ${pass} passed, ${fail} failed`)
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
