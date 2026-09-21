// DEVELOPMENT-ONLY: ask the RUNNING Solid Skill dev app to import the current live MT5 receiver staging.
//
//   npm run dev:mt5-live-import [-- --account "***514"]
//
// Prerequisite: the app is running as
//   SOLID_SKILL_MT5_BRIDGE=1 SOLID_SKILL_MT5_DEV_IMPORT=1 npm run dev
// with the real MT5 EA connected and its history sync complete. This script
// only writes one small request file and prints the (masked) result; it never
// opens the database, never talks to MT5, and needs no credentials. The app's
// gate re-checks everything (dev profile, currency from hello, complete sync).
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

const dir = resolve('.dev-data', 'mt5')
const requestPath = join(dir, 'live-import-request.json')
const resultPath = join(dir, 'live-import-result.json')
const accountIndex = process.argv.indexOf('--account')
const account = accountIndex >= 0 ? process.argv[accountIndex + 1] : undefined

mkdirSync(dir, { recursive: true })
if (existsSync(resultPath)) unlinkSync(resultPath)
const requestId = randomUUID()
const request = {
  action: 'import-live-staging',
  confirm: 'WRITE-DEV-DB',
  requestId,
  createdAt: Date.now(),
  ...(account === undefined ? {} : { account })
}
writeFileSync(requestPath, `${JSON.stringify(request)}\n`, 'utf8')
console.log('Live-staging import requested. Waiting for the running app (up to 30 s)...')

const deadline = Date.now() + 30_000
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500))
  if (!existsSync(resultPath)) continue
  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  if (result.requestId !== requestId && result.requestId !== null) continue
  if (result.ok) {
    for (const line of result.lines) console.log(line)
    process.exit(0)
  }
  console.error(`REFUSED/FAILED: ${result.reason}: ${result.message}`)
  process.exit(1)
}
if (existsSync(requestPath)) unlinkSync(requestPath) // never leave a pending request behind
console.error('No response: is the app running with SOLID_SKILL_MT5_DEV_IMPORT=1 (unpackaged dev build)? The request was withdrawn.')
process.exit(1)
