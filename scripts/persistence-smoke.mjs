// Bundles src/main/persistence/__smoke__/smoke.ts and runs it inside the real
// Electron main-process runtime (NOT system Node), against temporary databases.
// Usage: npm run smoke:persistence
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const outDir = resolve('out/smoke')

await build({
  configFile: false,
  logLevel: 'warn',
  // The trading smoke also exercises the renderer's pure mapping helpers.
  resolve: { alias: { '@renderer': resolve('src/renderer/src'), '@shared': resolve('src/shared') } },
  build: {
    ssr: resolve('src/main/persistence/__smoke__/smoke.ts'),
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: ['electron', /^node:/],
      output: { format: 'cjs', entryFileNames: 'smoke.cjs' }
    }
  },
  ssr: { noExternal: true }
})

const scratch = mkdtempSync(join(tmpdir(), 'solid-skill-smoke-out-'))
const outFile = join(scratch, 'result.txt')
const run = spawnSync(electronPath, [join(outDir, 'smoke.cjs')], {
  env: { ...process.env, SMOKE_OUT: outFile },
  stdio: 'ignore'
})
let report = ''
try {
  report = readFileSync(outFile, 'utf8')
} catch {
  report = '(no report was written — the Electron process failed before the suite ran)'
}
rmSync(scratch, { recursive: true, force: true })
console.log(report)
process.exit(run.status === 0 ? 0 : 1)
