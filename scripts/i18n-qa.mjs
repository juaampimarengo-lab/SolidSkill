// Localization QA (Checkpoint 012C). Launches the REAL built app
// (`npm run build` first) against a THROWAWAY COPY of the solid-skill-dev
// database and preferences, so real development data is never opened for
// writing. Drives the renderer over the Chrome DevTools Protocol: switches
// language through Settings and reads what the Strategy Builder / Active
// Account controls show.
// Usage: node scripts/i18n-qa.mjs   (QA_SHOTS=<dir> saves screenshots)
// Development tooling only.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const electronPath = createRequire(import.meta.url)('electron')
const source = process.env.QA_SOURCE ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'solid-skill-dev')
const userData = mkdtempSync(join(tmpdir(), 'solid-skill-i18n-qa-'))
const shotDir = process.env.QA_SHOTS
if (shotDir) mkdirSync(shotDir, { recursive: true })
const PORT = 9339
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
async function shot(c, name) {
  if (!shotDir) return
  const r = await c.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.data, 'base64'))
}
const api = (c, expr) => c.eval(`(async () => JSON.stringify(await ${expr}))()`).then(JSON.parse)
async function nav(c, section) {
  await clickButton(c, section)
  await sleep(500)
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

  check('settings API is exposed and defaults to English', (await api(c, 'window.solidSkill.settings.getLanguage()')).data.language === 'en')

  await nav(c, 'Strategies')
  await sleep(300)
  await shot(c, '01-strategies-english')
  const englishBody = await body(c)
  check('Strategy Builder shows English guidance before switching', /frozen, read-only|No strategies/i.test(englishBody))

  const accountsBefore = await api(c, 'window.solidSkill.accounts.list()')
  const activeBefore = accountsBefore.data.activeAccountId

  await nav(c, 'Settings')
  await shot(c, '02-settings-english')
  check('Settings screen shows the Language control', (await body(c)).includes('Language'))

  // ---- English -> Español ----
  check('select Español', await click(c, 'button[role=radio]', 'Español'))
  await sleep(500)
  await shot(c, '03-settings-espanol')
  check('language switched to es', (await api(c, 'window.solidSkill.settings.getLanguage()')).data.language === 'es')

  await nav(c, 'Strategies')
  await sleep(300)
  await shot(c, '04-strategies-espanol')
  const spanishBody = await body(c)
  check(
    'Strategy Builder guidance is now in Spanish',
    /congelada, solo lectura|No hay Strategies/i.test(spanishBody)
  )
  check('canonical trading terminology (Trade/Strategy) is not translated', /Trade/.test(spanishBody))

  const accountsAfter = await api(c, 'window.solidSkill.accounts.list()')
  check('active account survives the language switch', accountsAfter.data.activeAccountId === activeBefore)

  // ---- Español -> English ----
  await nav(c, 'Settings')
  check('select English', await click(c, 'button[role=radio]', 'English'))
  await sleep(500)
  check('language switched back to en', (await api(c, 'window.solidSkill.settings.getLanguage()')).data.language === 'en')
  await nav(c, 'Strategies')
  await sleep(300)
  const backToEnglish = await body(c)
  check('Strategy Builder guidance is English again', /frozen, read-only|No strategies/i.test(backToEnglish))

  // ---- restart persistence (Español) ----
  await nav(c, 'Settings')
  await click(c, 'button[role=radio]', 'Español')
  await sleep(500)
  await close(c)
  c = await launch()
  check('after restart Español is remembered', (await api(c, 'window.solidSkill.settings.getLanguage()')).data.language === 'es')
  await shot(c, '05-after-restart-espanol')

  await nav(c, 'Settings')
  await click(c, 'button[role=radio]', 'English')
  await sleep(500)
  await close(c)

  check('no historical Trade fact changed in the QA copy', factsDigest(userData) === before)
  console.log(`\ni18n QA: ${pass} passed, ${fail} failed`)
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
