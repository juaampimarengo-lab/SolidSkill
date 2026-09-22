// End-to-end restart QA for persistent Strategies (Checkpoint 011B-1).
// Launches the REAL built app (`npm run build` first) against a throwaway
// --user-data-dir, drives the renderer over the Chrome DevTools Protocol, and
// closes the app GRACEFULLY between runs so the restart is genuine. Exercises
// the whole path: React UI -> preload -> IPC -> main -> repositories -> SQLite.
//
// Usage: node scripts/strategy-restart-qa.mjs   (or npm run qa:strategies-restart)
// Development tooling only; it never touches the real application database.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const electronPath = createRequire(import.meta.url)('electron')
const userData = mkdtempSync(join(tmpdir(), 'solid-skill-qa-'))
const shotDir = process.env.QA_SHOTS
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${detail}`}`)
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
const clickText = (cdp, text, root = 'document') =>
  cdp.eval(`(() => {
    const el = [...${root}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)
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
const clickRow = (cdp, name) =>
  cdp.eval(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)}) && b.textContent.includes('trade'))
    if (!el) return false
    el.click(); return true
  })()`)
const typeInto = (cdp, selector, value) =>
  cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
const api = (cdp, expr) => cdp.eval(`(async () => JSON.stringify(await ${expr}))()`).then(JSON.parse)
const list = async (cdp) => (await api(cdp, 'window.solidSkill.strategies.list()')).data
const byName = (all, name) => all.find((s) => s.name === name)
async function openStrategies(cdp, name) {
  await clickText(cdp, 'Strategies')
  await sleep(400)
  await clickRow(cdp, name)
  await sleep(300)
}
async function shot(cdp, name) {
  if (!shotDir) return
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.data, 'base64'))
}

try {
  // ============================== RUN 1 (clean dev DB) =====================
  let cdp = await launch()
  check('preload bridge exposes only the strategies + trades APIs',
    JSON.stringify(await cdp.eval('Object.keys(window.solidSkill)')) === '["strategies","trades","accounts"]')
  check('renderer has no raw ipc / require / process access',
    (await cdp.eval('typeof require + "," + typeof process + "," + typeof ipcRenderer')) === 'undefined,undefined,undefined')
  check('DB created under the userData dir; first start applied migration 1 + dev seed',
    /opened .*solid-skill\.db .*migrations applied this start: 1/.test(logs) && /development seed applied/.test(logs), logs)
  check('foreign keys on, WAL', /foreign_keys=on/.test(logs) && /journal=wal/.test(logs))

  await clickText(cdp, 'Strategies')
  await sleep(600)
  let text = await body(cdp)
  check('Strategies load from SQLite: Alpha/Beta/Gamma listed', /Strategy Alpha/.test(text) && /Strategy Beta/.test(text) && /Strategy Gamma/.test(text))
  await shot(cdp, '01-strategies-loaded')

  // Flow 1: change Alpha description through the UI
  await clickRow(cdp, 'Strategy Alpha')
  await sleep(300)
  check('UI: Edit details opens', await clickText(cdp, 'Edit details'))
  await sleep(200)
  await typeInto(cdp, 'textarea[aria-label="Strategy description"]', 'Alpha description CHANGED in QA')
  check('UI: Save details', await clickText(cdp, 'Save details'))
  await sleep(500)
  check('description visible after save', /Alpha description CHANGED in QA/.test(await body(cdp)))
  await close(cdp)

  // ============================== RUN 2 ====================================
  cdp = await launch()
  check('second start: migration NOT re-applied, seed NOT re-applied',
    /migrations applied this start: none/.test(logs) && !/development seed applied/.test(logs), logs)
  await openStrategies(cdp, 'Strategy Alpha')
  check('F1: description remains changed after restart', /Alpha description CHANGED in QA/.test(await body(cdp)))
  let all = await list(cdp)
  check('F1: still exactly one Alpha, v1-v3, no draft', all.filter((s) => s.name === 'Strategy Alpha').length === 1 &&
    byName(all, 'Strategy Alpha').versions.length === 3 && byName(all, 'Strategy Alpha').draft === null)

  // Flow 2: Alpha v3 -> Edit Rules -> change Rule B, add Rule F, do NOT publish
  const v3Before = JSON.stringify(byName(all, 'Strategy Alpha').versions[2])
  await clickTab(cdp, 'Rules')
  await sleep(200)
  check('UI: Edit Rules starts a draft', await clickText(cdp, 'Edit Rules'))
  await sleep(500)
  text = await body(cdp)
  check('UI: shows "Draft based on v3"', /Draft based on v3/.test(text))
  const alpha = byName(await list(cdp), 'Strategy Alpha')
  const ruleB = alpha.draft.groups.flatMap((g) => g.rules).find((r) => r.name === 'Rule B')
  const groupB = alpha.draft.groups.find((g) => g.name === 'Group B')
  const edit = (e) => api(cdp, `window.solidSkill.strategies.editDraft(${JSON.stringify({ strategyId: alpha.id, edit: e })})`)
  await edit({ type: 'updateRule', ruleId: ruleB.id, name: 'Rule B', kind: 'Optional', description: 'Rule B changed in QA' })
  const r1 = await edit({ type: 'addRule', groupId: groupB.id, name: 'Rule F', kind: 'Conditional', description: 'Rule F added in QA' })
  check('draft edits accepted over IPC', r1.ok === true)
  await close(cdp)

  // ============================== RUN 3 ====================================
  cdp = await launch()
  await openStrategies(cdp, 'Strategy Alpha')
  await clickTab(cdp, 'Rules')
  await sleep(400)
  text = await body(cdp)
  check('F2: draft survives restart with both changes (UI)', /Draft based on v3/.test(text) && /Rule F/.test(text) && /Rule B changed in QA/.test(text))
  await shot(cdp, '02-draft-after-restart')
  all = await list(cdp)
  check('F2: published v3 unchanged', JSON.stringify(byName(all, 'Strategy Alpha').versions[2]) === v3Before)
  check('F2: still exactly one draft, three published versions',
    byName(all, 'Strategy Alpha').versions.length === 3 && byName(all, 'Strategy Alpha').draft !== null)

  // Flow 3: publish as v4 through the UI
  check('UI: Publish changes as v4', await clickText(cdp, 'Publish changes as v4'))
  await sleep(200)
  check('UI: confirm publish', await clickText(cdp, 'Confirm publish'))
  await sleep(600)
  all = await list(cdp)
  check('F3: v4 is current, draft consumed',
    byName(all, 'Strategy Alpha').versions.map((v) => v.number).join() === '1,2,3,4' && byName(all, 'Strategy Alpha').draft === null)
  await close(cdp)

  // ============================== RUN 4 ====================================
  cdp = await launch()
  await openStrategies(cdp, 'Strategy Alpha')
  await clickTab(cdp, 'Versions')
  await sleep(300)
  text = await body(cdp)
  all = await list(cdp)
  check('F3: v4 still current after restart; v1-v3 present (UI)', /v4\s*Current/.test(text) && /v3\s*Historical/.test(text) && /v1\s*Historical/.test(text), text)
  check('F3: v3 readable and unchanged', JSON.stringify(byName(all, 'Strategy Alpha').versions[2]) === v3Before)
  await shot(cdp, '03-versions-v4-current')

  // Flow 4: create a new strategy through the UI, add rules, close before publishing
  await clickText(cdp, 'Create')
  await sleep(200)
  await typeInto(cdp, 'input[aria-label="Strategy name"]', 'Strategy Delta')
  await typeInto(cdp, 'textarea[aria-label="Strategy description"]', 'Created in QA')
  check('UI: Create draft', await clickText(cdp, 'Create draft'))
  await sleep(600)
  const delta = byName(await list(cdp), 'Strategy Delta')
  check('F4: new strategy has an initial draft and NO fabricated v1', delta && delta.draft !== null && delta.versions.length === 0)
  const ed = (e) => api(cdp, `window.solidSkill.strategies.editDraft(${JSON.stringify({ strategyId: delta.id, edit: e })})`)
  const g = (await ed({ type: 'addGroup', name: 'Group X' })).data.draft.groups[0]
  await ed({ type: 'addRule', groupId: g.id, name: 'Rule 1', kind: 'Required', description: 'one' })
  await ed({ type: 'addRule', groupId: g.id, name: 'Rule 2', kind: 'Optional', description: 'two' })
  await close(cdp)

  // ============================== RUN 5 ====================================
  cdp = await launch()
  all = await list(cdp)
  const d2 = byName(all, 'Strategy Delta')
  check('F4: new strategy + initial draft survive restart', d2 && d2.versions.length === 0 && d2.draft.groups[0].rules.map((r) => r.name).join() === 'Rule 1,Rule 2')
  const pub = await api(cdp, `window.solidSkill.strategies.publishDraft(${JSON.stringify(d2.id)})`)
  check('F4: publish creates v1', pub.ok && pub.data.versions.map((v) => v.number).join() === '1' && pub.data.draft === null)

  // Flow 5: archive Beta through the UI
  await openStrategies(cdp, 'Strategy Beta')
  check('UI: Archive Beta', await clickText(cdp, 'Archive'))
  await sleep(500)
  check('UI shows Archived', /Archived/.test(await body(cdp)))
  await close(cdp)

  // ============================== RUN 6 ====================================
  cdp = await launch()
  all = await list(cdp)
  check('F5: Beta remains Archived after restart', byName(all, 'Strategy Beta').status === 'Archived')
  check('F4: Delta v1 remains after restart', byName(all, 'Strategy Delta').versions.length === 1)
  await openStrategies(cdp, 'Strategy Beta')
  check('UI: Restore Beta', await clickText(cdp, 'Restore'))
  await sleep(500)
  await close(cdp)

  // ============================== RUN 7 ====================================
  cdp = await launch()
  all = await list(cdp)
  check('F5: Beta remains Active after restore + restart', byName(all, 'Strategy Beta').status === 'Active')
  check('seed still idempotent on a 6th start (no duplicate Alpha)', all.filter((s) => s.name === 'Strategy Alpha').length === 1 && !/development seed applied/.test(logs))
  // Other workspaces still render
  for (const section of ['Dashboard', 'Journal', 'Calendar']) {
    await clickText(cdp, section)
    await sleep(500)
    const t = await body(cdp)
    check(`${section} still renders`, t.length > 200 && !/Strategies could not be loaded/.test(t))
    await shot(cdp, `04-${section.toLowerCase()}`)
  }
  await clickText(cdp, 'Strategies')
  await sleep(400)
  await shot(cdp, '05-strategies-final')
  await close(cdp)
  check('clean shutdown logged', /database closed/.test(logs))

  // ====================== persistence failure path =========================
  // A corrupt database file must surface as an error state, never fixtures.
  rmSync(join(userData, 'solid-skill.db-wal'), { force: true })
  rmSync(join(userData, 'solid-skill.db-shm'), { force: true })
  writeFileSync(join(userData, 'solid-skill.db'), 'this is not a sqlite database'.repeat(50))
  cdp = await launch()
  check('failure logged; app still starts', /failed to initialize database/.test(logs))
  await clickText(cdp, 'Strategies')
  await sleep(600)
  text = await body(cdp)
  check('J: UI shows an error state (not fixtures, not empty data)',
    /Strategies could not be loaded/.test(text) && !/Strategy Alpha/.test(text) && !/No strategies/.test(text), text)
  const unavailable = await api(cdp, 'window.solidSkill.strategies.list()')
  check('J: IPC reports PERSISTENCE_UNAVAILABLE', unavailable.ok === false && unavailable.error.code === 'PERSISTENCE_UNAVAILABLE')
  await shot(cdp, '06-persistence-error')
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
