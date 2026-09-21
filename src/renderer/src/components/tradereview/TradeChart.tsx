import type { JSX } from 'react'
import { toNumber } from '@renderer/lib/decimal'
import type { ExecutionSide, TradeExecution, TradeSummary } from '@renderer/types/journal'
import styles from './TradeChart.module.css'

// A restrained, clearly-illustrative execution/price visualization — NOT
// real market data. The path is a deterministic pseudo-random walk seeded
// from the trade's own id so it stays stable across re-renders, anchored at
// the trade's actual avg entry/exit prices with each real persisted execution
// plotted at its proportional time along the trade's open→close window (see
// CLAUDE.md checkpoint instructions, "TRADE REVIEW — CHART / EXECUTION
// VISUALIZATION").

function hashSeed(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0
  return h || 1
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface PathPoint {
  x: number
  y: number
}

interface Marker {
  x: number
  y: number
  side: ExecutionSide
}

const WIDTH = 560
const HEIGHT = 140
const PAD = 10

export function TradeChart({
  trade,
  executions
}: {
  trade: TradeSummary
  executions: readonly TradeExecution[]
}): JSX.Element {
  // Plot coordinates only: prices are converted from exact decimal strings to
  // numbers for drawing, never written back.
  const avgEntry = toNumber(trade.avgEntry)
  const avgExit = trade.avgExit === null ? avgEntry : toNumber(trade.avgExit)
  const openSec = trade.openedAt / 1000
  const lastExecution = executions[executions.length - 1]
  const closeMs = trade.closedAt ?? lastExecution?.executedAt ?? trade.openedAt
  const closeSec = Math.max(closeMs / 1000, openSec + 1)
  const span = closeSec - openSec

  const rand = mulberry32(hashSeed(trade.id))
  const priceRange = Math.max(Math.abs(avgExit - avgEntry), avgEntry * 0.001)
  const lo = Math.min(avgEntry, avgExit) - priceRange * 0.6
  const hi = Math.max(avgEntry, avgExit) + priceRange * 0.6

  const steps = 24
  const path: PathPoint[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const base = avgEntry + (avgExit - avgEntry) * t
    const noise = (rand() - 0.5) * priceRange * 0.9
    path.push({ x: t, y: base + noise })
  }
  // Anchor the walk's actual endpoints to the real avg entry/exit so the
  // markers below always land on the line.
  path[0].y = avgEntry
  path[steps].y = avgExit

  const markers: Marker[] = executions.map((execution) => ({
    x: Math.min(1, Math.max(0, (execution.executedAt / 1000 - openSec) / span)),
    y: toNumber(execution.price),
    side: execution.side
  }))

  const scaleX = (x: number): number => PAD + x * (WIDTH - PAD * 2)
  const scaleY = (y: number): number => {
    const t = (y - lo) / (hi - lo || 1)
    return HEIGHT - PAD - t * (HEIGHT - PAD * 2)
  }

  const polylinePoints = path.map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(' ')

  return (
    <div className={styles.wrap}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="Trade price path">
        <polyline points={polylinePoints} className={styles.line} fill="none" />
        {markers.map((marker, i) => (
          <g key={i}>
            <circle
              cx={scaleX(marker.x)}
              cy={scaleY(marker.y)}
              r={4}
              className={marker.side === 'BUY' ? styles.markerBuy : styles.markerSell}
            />
          </g>
        ))}
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.markerBuy}`} /> Buy
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.markerSell}`} /> Sell
        </span>
        <span className={styles.disclaimer}>Illustrative price path — not real market data.</span>
      </div>
    </div>
  )
}
