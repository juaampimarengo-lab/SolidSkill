// DEVELOPMENT-ONLY MT5 import gate over the local raw snapshot (.dev-data/mt5, gitignored).
//
//   npm run qa:mt5-import                     dry run (default): writes NOTHING to the real database
//   npm run dev:mt5-import -- --currency USD --confirm-write
//                                             REAL import into the DEVELOPMENT database only
//   node scripts/mt5-import-qa.mjs --report   read-only inspection of the imported account(s)
//
// Nothing else in the application imports MT5 trades: normal startup never does.
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(
  await bundleAndRun('src/main/integrations/mt5/import/__qa__/importCli.ts', 'mt5-import-qa', process.argv.slice(2))
)
