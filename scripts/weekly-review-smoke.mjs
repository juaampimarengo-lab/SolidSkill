// Weekly Review suite (Checkpoint 015): week identity, migration 004, review
// facts, pure derivation, authored persistence, IPC validation. Temporary
// databases only. Usage: npm run smoke:weekly-review
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(await bundleAndRun('src/main/review/__smoke__/weeklyReviewSmoke.ts', 'weekly-review-smoke'))
