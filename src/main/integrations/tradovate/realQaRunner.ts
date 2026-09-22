// Entry point bundled by scripts/tradovate-real-qa.mjs. Kept separate from
// realQa.ts so the QA logic itself stays testable/importable without a
// process-level side effect.
import { runTradovateRealQa } from './realQa'

runTradovateRealQa(process.env, process.cwd())
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
