import type { JSX } from 'react'
import { equityCurve } from '@renderer/data/dummyData'
import { formatUsd } from '@renderer/lib/format'
import styles from './EquityChart.module.css'

const WIDTH = 560
const HEIGHT = 200
const PAD_TOP = 12
const PAD_RIGHT = 12
const PAD_BOTTOM = 20
const PAD_LEFT = 52

export function EquityChart(): JSX.Element {
  const xs = equityCurve.map((p) => p.x)
  const ys = equityCurve.map((p) => p.y)
  const minY = Math.min(0, ...ys)
  const maxY = Math.max(...ys)
  const spanY = maxY - minY || 1
  const maxX = Math.max(...xs) || 1

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM

  const toX = (x: number): number => PAD_LEFT + (x / maxX) * plotW
  const toY = (y: number): number => PAD_TOP + plotH - ((y - minY) / spanY) * plotH

  const linePoints = equityCurve.map((p) => `${toX(p.x)},${toY(p.y)}`).join(' ')

  const zeroY = toY(0)
  const areaPoints = [
    `${toX(0)},${zeroY}`,
    ...equityCurve.map((p) => `${toX(p.x)},${toY(p.y)}`),
    `${toX(maxX)},${zeroY}`
  ].join(' ')

  const tickCount = 4
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => minY + (spanY / tickCount) * i)

  const latest = equityCurve[equityCurve.length - 1].y
  const areaColor = latest >= 0 ? 'var(--positive-subtle)' : 'var(--negative-subtle)'

  return (
    <section className={styles.widget}>
      <span className={styles.title}>Equity Curve — This Week</span>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="Equity curve chart">
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={toY(tick)}
              y2={toY(tick)}
              className={styles.gridLine}
            />
            <text x={PAD_LEFT - 8} y={toY(tick) + 3} className={styles.axisLabel} textAnchor="end">
              {formatUsd(Math.round(tick))}
            </text>
          </g>
        ))}

        <line
          x1={PAD_LEFT}
          x2={WIDTH - PAD_RIGHT}
          y1={zeroY}
          y2={zeroY}
          className={styles.zeroLine}
        />

        <polygon points={areaPoints} fill={areaColor} stroke="none" />
        <polyline points={linePoints} className={styles.line} fill="none" />
      </svg>
    </section>
  )
}
