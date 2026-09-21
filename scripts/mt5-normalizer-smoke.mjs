// Pure MT5 normalizer suite (no MetaTrader, no real account, no SQLite).
// Usage: npm run smoke:mt5-normalizer
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(await bundleAndRun('src/main/integrations/mt5/normalizer/__smoke__/normalizerSmoke.ts', 'mt5-normalizer-smoke'))
