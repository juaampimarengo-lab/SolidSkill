// Bundles src/main/integrations/mt5/__smoke__/mt5Smoke.ts and runs it on the
// Electron-embedded Node runtime (ELECTRON_RUN_AS_NODE) — the same Node the
// main process uses. Needs no MetaTrader and no real account.
// Usage: npm run smoke:mt5
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const outDir = resolve('out/smoke-mt5')

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: resolve('src/main/integrations/mt5/__smoke__/mt5Smoke.ts'),
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: [/^node:/],
      output: { format: 'cjs', entryFileNames: 'mt5-smoke.cjs' }
    }
  },
  ssr: { noExternal: true }
})

const run = spawnSync(electronPath, [resolve(outDir, 'mt5-smoke.cjs')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 120_000
})
process.stdout.write(run.stdout ?? '')
if (run.stderr) process.stderr.write(run.stderr)
process.exit(run.status === 0 ? 0 : 1)
