// Shared helper: bundles a TypeScript entry with Vite (SSR, CJS) and runs it on
// the Electron-embedded Node runtime (ELECTRON_RUN_AS_NODE), the same Node the
// main process uses. Same approach as scripts/mt5-smoke.mjs.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'vite'

export async function bundleAndRun(entry, name, args = []) {
  const require = createRequire(import.meta.url)
  const electronPath = require('electron')
  const outDir = resolve(`out/${name}`)
  await build({
    configFile: false,
    logLevel: 'warn',
    // Suites that exercise the renderer's pure helpers (e.g. weekly-review) resolve its aliases.
    resolve: { alias: { '@renderer': resolve('src/renderer/src'), '@shared': resolve('src/shared') } },
    build: {
      ssr: resolve(entry),
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { external: [/^node:/], output: { format: 'cjs', entryFileNames: `${name}.cjs` } }
    },
    ssr: { noExternal: true }
  })
  const run = spawnSync(electronPath, [resolve(outDir, `${name}.cjs`), ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 120_000
  })
  process.stdout.write(run.stdout ?? '')
  if (run.stderr) process.stderr.write(run.stderr)
  return run.status === 0 ? 0 : 1
}
