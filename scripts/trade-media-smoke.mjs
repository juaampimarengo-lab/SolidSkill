// Chart Evidence / Trade Media suite (synthetic fixtures, temporary SQLite + temp media folder).
// Usage: npm run smoke:trade-media
import { bundleAndRun } from './_bundleRun.mjs'

process.exit(await bundleAndRun('src/main/media/__smoke__/mediaSmoke.ts', 'trade-media-smoke'))
