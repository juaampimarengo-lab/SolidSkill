// Journal row interaction suite (Checkpoint 014): single click vs. double
// click vs. Enter row activation. Pure logic, no fixtures needed.
// Usage: npm run smoke:journal-row-activation
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(await bundleAndRun('src/main/journal/__smoke__/journalRowActivation.smoke.ts', 'journal-row-activation-smoke'))
