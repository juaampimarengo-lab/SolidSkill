// MT5 automatic reconciliation suite (synthetic fixtures, in-memory SQLite, no MetaTrader).
// Usage: npm run smoke:mt5-reconciliation
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(await bundleAndRun('src/main/integrations/mt5/reconciliation/__smoke__/reconciliationSmoke.ts', 'mt5-reconciliation-smoke'))
