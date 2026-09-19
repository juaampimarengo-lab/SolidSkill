import type { JSX } from 'react'
import { formatUsd } from '@renderer/lib/format'
import type { JournalTrade } from '@renderer/types/journal'
import styles from './IntradayPnlChart.module.css'

// Compact intraday CUMULATIVE NET P&L strip — not an equity curve. It plots
// realized net P&L summed after each of the day's already-completed trades,
// in chronological order. Every input value is a precomputed dummy fixture
// field (JournalTrade.netPnl); this derives no execution-level or unrealized
// P&L, and implies nothing about real-time account equity. See CLAUDE.md
// checkpoint instructions, "GOAL 2 — DAY REVIEW INTRADAY CUMULATIVE NET P&L."

const WIDTH = 280
const HEIGHT = 108
const PAD_X = 8
const PAD_TOP = 12
const PAD_BOTTOM = 20

interface CumulativePoint {
  trade: JournalTrade
  cumulative: number
}

export function IntradayPnlChart({ dayTrades }: { dayTrades: JournalTrade[] }): JSX.Element {
  if (dayTrades.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>No trades to plot.</div>
      </div>
    )
  }

  let running = 0
  const points: CumulativePoint[] = dayTrades.map((trade) => {
    running += trade.netPnl
    return { trade, cumulative: running }
  })

  const values = [0, ...points.map((p) => p.cumulative)]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const range = hi - lo || 1

  const plotWidth = WIDTH - PAD_X * 2
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM

  const scaleY = (value: number): number => PAD_TOP + plotHeight - ((value - lo) / range) * plotHeight
  const scaleX = (index: number): number =>
    points.length === 1 ? WIDTH / 2 : PAD_X + (index / (points.length - 1)) * plotWidth

  const zeroY = scaleY(0)
  const showZeroLine = lo < 0 && hi > 0

  const coords = points.map((p, i) => ({ x: scaleX(i), y: scaleY(p.cumulative) }))
  const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')

  const final = points[points.length - 1].cumulative
  const finalClass = final > 0 ? styles.dotPositive : final < 0 ? styles.dotNegative : styles.dotNeutral

  // Show first/last trade times always; interior ticks only when there's
  // room to keep them from colliding.
  const showAllTicks = points.length <= 6

  return (
    <div className={styles.wrap}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="Intraday cumulative net P&L">
        {showZeroLine && (
          <line x1={PAD_X} y1={zeroY} x2={WIDTH - PAD_X} y2={zeroY} className={styles.zeroLine} />
        )}
        <polyline points={linePoints} className={styles.line} fill="none" />
        {coords.map((c, i) => (
          <circle
            key={points[i].trade.id}
            cx={c.x}
            cy={c.y}
            r={i === coords.length - 1 ? 3 : 2}
            className={
              points[i].cumulative > 0
                ? styles.dotPositive
                : points[i].cumulative < 0
                  ? styles.dotNegative
                  : styles.dotNeutral
            }
          />
        ))}
      </svg>
      <div className={styles.axis}>
        {points.map((p, i) => {
          const isEdge = i === 0 || i === points.length - 1
          if (!isEdge && !showAllTicks) return null
          return (
            <span key={p.trade.id} className={styles.tick} style={{ left: `${(scaleX(i) / WIDTH) * 100}%` }}>
              {p.trade.openTime.slice(0, 5)}
            </span>
          )
        })}
      </div>
      <div className={styles.footer}>
        <span className={styles.footerLabel}>Final cumulative</span>
        <span className={`num ${styles.footerValue} ${finalClass}`}>{formatUsd(final)}</span>
      </div>
    </div>
  )
}
