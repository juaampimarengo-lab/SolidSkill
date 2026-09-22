// DEVELOPMENT-ONLY: attempts a REAL, read-only Tradovate connection and
// prints a privacy-safe structural report (013B). Needs
// SOLID_SKILL_TRADOVATE_NAME/PASSWORD/APP_ID/APP_VERSION/CID/SEC in the
// environment (never committed, never hardcoded) — if any are missing, this
// prints the exact blocker and exits 0 without attempting a connection.
// Never touches SQLite. Usage: npm run dev:tradovate-real-qa
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const outDir = resolve('out/tradovate-real-qa')

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: resolve('src/main/integrations/tradovate/realQaRunner.ts'),
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: [/^node:/],
      output: { format: 'cjs', entryFileNames: 'tradovate-real-qa.cjs' }
    }
  },
  ssr: { noExternal: true }
})

const run = spawnSync(electronPath, [resolve(outDir, 'tradovate-real-qa.cjs')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 120_000
})
process.stdout.write(run.stdout ?? '')
if (run.stderr) process.stderr.write(run.stderr)
process.exit(run.status === 0 ? 0 : 1)
