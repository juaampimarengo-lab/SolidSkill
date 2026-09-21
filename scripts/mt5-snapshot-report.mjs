// Structure-only report over a LOCAL development raw snapshot
// (.dev-data/mt5/*.json, gitignored). Diagnostics, not an import.
// Usage: npm run qa:mt5-snapshot [-- path/to/snapshot.json]
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(
  await bundleAndRun('src/main/integrations/mt5/normalizer/__smoke__/snapshotReport.ts', 'mt5-snapshot-report', process.argv.slice(2))
)
