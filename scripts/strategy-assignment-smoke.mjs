// Strategy Assignment + Strategy list ordering suite (Checkpoint 015B):
// one-time exact-version assignment, UNREVIEWED initialization, rollback,
// evaluation path, Weekly Review / achievements read-through, historical fact
// safety, migration 006 and list ordering. Temporary databases only.
// Usage: npm run smoke:strategy-assignment
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(await bundleAndRun('src/main/strategies/__smoke__/strategyAssignmentSmoke.ts', 'strategy-assignment-smoke'))
