// MT5 Import Service suite (synthetic fixtures, in-memory SQLite, no MetaTrader).
// Usage: npm run smoke:mt5-import
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(await bundleAndRun('src/main/integrations/mt5/import/__smoke__/importSmoke.ts', 'mt5-import-smoke'))
