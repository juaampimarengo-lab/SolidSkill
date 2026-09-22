/**
 * Journal row interaction smoke suite (Checkpoint 014). Development tooling
 * only — not imported by the application. Run with
 * `npm run smoke:journal-row-activation`.
 *
 * Proves the row-activation decision used by TradeTable:
 *   - a plain click only ever selects the row (quick preview stays put)
 *   - a double-click navigates to Full Review, unless it started on an
 *     interactive control inside the row
 *   - an Enter key press behaves the same as a double-click
 *   - both routes resolve to the same "openFull" effect that
 *     JournalWorkspace wires to the app's single onOpenTradeReview
 *     navigation helper — no duplicated route logic, so active Account
 *     context (owned entirely by that helper) is never touched here
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { decideRowActivation, isInteractiveRowTarget, type RowActivationTarget } from '../../../renderer/src/lib/journalRowActivation'

const outFile = process.env['SMOKE_OUT']
if (outFile !== undefined) writeFileSync(outFile, '')

let passed = 0
let failed = 0
function log(line: string): void {
  if (outFile !== undefined) appendFileSync(outFile, `${line}\n`)
  else console.log(line)
}
function check(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
function equal<T>(actual: T, expected: T, label = 'value'): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
}

function plainCell(): RowActivationTarget {
  return { closest: () => null }
}
function insideButton(): RowActivationTarget {
  return { closest: (selector: string) => (selector.includes('button') ? {} : null) }
}

check('single click always selects, never opens Full Review', () => {
  equal(decideRowActivation('click', plainCell()), 'select')
  equal(decideRowActivation('click', insideButton()), 'select', 'even from an interactive control, a click only selects')
})

check('double click on a plain cell opens Full Review', () => {
  equal(decideRowActivation('doubleClick', plainCell()), 'openFull')
})

check('Enter key on a plain cell opens Full Review, same effect as double click', () => {
  equal(decideRowActivation('enterKey', plainCell()), 'openFull')
})

check('double click / Enter on an interactive control inside the row is ignored, not a second selection path', () => {
  equal(decideRowActivation('doubleClick', insideButton()), 'ignore')
  equal(decideRowActivation('enterKey', insideButton()), 'ignore')
})

check('isInteractiveRowTarget treats a missing or non-DOM target as non-interactive', () => {
  equal(isInteractiveRowTarget(null), false)
  equal(isInteractiveRowTarget(undefined), false)
})

check('openFull is the single effect both double click and Enter resolve to (one route, no duplicated logic)', () => {
  equal(decideRowActivation('doubleClick', plainCell()), decideRowActivation('enterKey', plainCell()))
})

log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
