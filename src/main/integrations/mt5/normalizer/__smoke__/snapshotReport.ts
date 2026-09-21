/**
 * QA CLI: structure-only report over a local development raw snapshot written
 * by the opt-in dev exporter (.dev-data/mt5/mt5-raw-*.json, gitignored).
 * Prints counts and masked identity only. Normalizes IN MEMORY; persists nothing.
 * Run with: npm run qa:mt5-snapshot [-- <snapshot.json>]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { devSnapshotDirectory, type Mt5DevSnapshot } from '../../devSnapshot'
import { buildStructuralReport, normalizeMt5Deals } from '../index'

function candidateFiles(): string[] {
  const explicit = process.argv.slice(2).filter((a) => a.endsWith('.json'))
  if (explicit.length > 0) return explicit.map((f) => resolve(f))
  const dir = devSnapshotDirectory(process.cwd())
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith('mt5-raw-') && f.endsWith('.json'))
    .map((f) => join(dir, f))
}

const files = candidateFiles()
if (files.length === 0) {
  console.log('No MT5 dev snapshot found (.dev-data/mt5 is empty or missing).')
  console.log('Capture one with SOLID_SKILL_MT5_BRIDGE=1 SOLID_SKILL_MT5_DEV_SNAPSHOT=1 npm run dev while MT5 is connected.')
  process.exit(0)
}
for (const file of files) {
  const snapshot = JSON.parse(readFileSync(file, 'utf8')) as Mt5DevSnapshot
  const result = normalizeMt5Deals(snapshot.deals, snapshot.account)
  console.log(`snapshot captured ${snapshot.capturedAt}`)
  console.log(JSON.stringify(buildStructuralReport(snapshot.deals, result), null, 2))
}
