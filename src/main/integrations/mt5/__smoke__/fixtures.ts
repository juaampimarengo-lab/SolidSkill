/**
 * Synthetic, anonymized MT5 deal fixtures (no real account data). Tickets,
 * prices and timestamps are invented. Each case is RAW FACTS ONLY; expected
 * segmentation into Trades is deliberately not encoded here.
 */
import type { DealSpec } from './fakeEa'

const T0 = 1_760_000_000_000 // arbitrary fixed instant, ms

const BUY = 0
const SELL = 1
const IN = 0
const OUT = 1
const INOUT = 2

/** CASE 1 — BUY IN, SELL OUT on one position: a LONG lifecycle. */
export const SIMPLE_LONG: DealSpec[] = [
  { ticket: '9001', order: '8001', position: '7001', timeMsc: T0, type: BUY, entry: IN, volume: '1.00', price: '1.08500', commission: '-3.5', magic: '11' },
  { ticket: '9002', order: '8002', position: '7001', timeMsc: T0 + 60_000, type: SELL, entry: OUT, volume: '1.00', price: '1.08650', profit: '150.00', commission: '-3.5' }
]

/** CASE 2 — SELL IN, BUY OUT: a SHORT lifecycle (closing BUY must not imply LONG). */
export const SIMPLE_SHORT: DealSpec[] = [
  { ticket: '9101', order: '8101', position: '7101', timeMsc: T0, type: SELL, entry: IN, volume: '1.00', price: '1.08500', commission: '-3.5' },
  { ticket: '9102', order: '8102', position: '7101', timeMsc: T0 + 60_000, type: BUY, entry: OUT, volume: '1.00', price: '1.08400', profit: '100.00', commission: '-3.5' }
]

/** CASE 3 — BUY 1, BUY 1, SELL 1, SELL 1 on one source position. */
export const SCALE_IN_PARTIAL_OUT: DealSpec[] = [
  { ticket: '9201', position: '7201', timeMsc: T0, type: BUY, entry: IN, volume: '1.00', price: '1.08500' },
  { ticket: '9202', position: '7201', timeMsc: T0 + 10_000, type: BUY, entry: IN, volume: '1.00', price: '1.08520' },
  { ticket: '9203', position: '7201', timeMsc: T0 + 20_000, type: SELL, entry: OUT, volume: '1.00', price: '1.08600', profit: '90.00' },
  { ticket: '9204', position: '7201', timeMsc: T0 + 30_000, type: SELL, entry: OUT, volume: '1.00', price: '1.08620', profit: '110.00' }
]

/** CASE 4 — hedging: independent same-symbol source positions, opposite directions, interleaved. */
export const HEDGING: DealSpec[] = [
  { ticket: '9301', position: '7301', timeMsc: T0, type: BUY, entry: IN, volume: '1.00', price: '1.08500' },
  { ticket: '9302', position: '7302', timeMsc: T0 + 5_000, type: SELL, entry: IN, volume: '1.00', price: '1.08490' },
  { ticket: '9303', position: '7301', timeMsc: T0 + 15_000, type: SELL, entry: OUT, volume: '1.00', price: '1.08550', profit: '50.00' },
  { ticket: '9304', position: '7303', timeMsc: T0 + 20_000, type: BUY, entry: IN, volume: '0.50', price: '1.08540' },
  { ticket: '9305', position: '7302', timeMsc: T0 + 25_000, type: BUY, entry: OUT, volume: '1.00', price: '1.08560', profit: '-70.00' }
]

/**
 * CASE 5 — netting reversal: LONG 1, then SELL 2 (entry INOUT). Raw facts
 * only. Whether MT5 keeps one position id across an INOUT reversal is an
 * open question to confirm against a real capture; the contract carries
 * whatever the terminal reports.
 */
export const NETTING_REVERSAL: DealSpec[] = [
  { ticket: '9401', position: '7401', timeMsc: T0, type: BUY, entry: IN, volume: '1.00', price: '1.08500' },
  { ticket: '9402', position: '7401', timeMsc: T0 + 30_000, type: SELL, entry: INOUT, volume: '2.00', price: '1.08600', profit: '100.00' }
]

/** CASE 9 — commission, fee, swap distinct; unreported (null) distinct from zero. */
export const COSTS: DealSpec[] = [
  {
    ticket: '9501',
    position: '7501',
    timeMsc: T0,
    type: BUY,
    entry: IN,
    volume: '1.00',
    price: '1.08500',
    profit: '0',
    commission: '-3.50',
    fee: '-0.25',
    swap: '-1.2'
  },
  {
    ticket: '9502',
    position: '7501',
    timeMsc: T0 + 1000,
    type: SELL,
    entry: OUT,
    volume: '1.00',
    price: '1.08600',
    profit: '100.00',
    commission: null,
    fee: '0.00000000',
    swap: null
  }
]

/** Deals used by the restart-gap case: d1,d2 known live; d3,d4 happened while Solid Skill was closed. */
export const RESTART_GAP: DealSpec[] = [
  { ticket: '9601', position: '7601', timeMsc: T0, type: BUY, entry: IN, volume: '1.00', price: '1.08500' },
  { ticket: '9602', position: '7601', timeMsc: T0 + 10_000, type: SELL, entry: OUT, volume: '1.00', price: '1.08550', profit: '50.00' },
  { ticket: '9603', position: '7602', timeMsc: T0 + 20_000, type: SELL, entry: IN, volume: '1.00', price: '1.08540' },
  { ticket: '9604', position: '7602', timeMsc: T0 + 30_000, type: BUY, entry: OUT, volume: '1.00', price: '1.08500', profit: '40.00' }
]
