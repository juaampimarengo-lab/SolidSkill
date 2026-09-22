import type { Database, EvaluationState, TradeSummaryRecord } from '../persistence'
import type { ComplianceCounts } from '../../shared/compliance'
import type {
  DayDto,
  EvaluatedGroupDto,
  ExecutionDto,
  RuleEvaluationResultDto,
  RuleStateDto,
  TradeDetailDto,
  TradeListDto,
  TradeListRequest,
  TradeStrategyDetailDto,
  TradeSummaryDto
} from '../../shared/ipc/trades'
import { ServiceError } from '../serviceError'

const STATE_TO_DB: Record<RuleStateDto, EvaluationState> = {
  Pass: 'PASS',
  Fail: 'FAIL',
  'N/A': 'N/A',
  Unreviewed: 'UNREVIEWED'
}
const STATE_FROM_DB: Record<EvaluationState, RuleStateDto> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  'N/A': 'N/A',
  UNREVIEWED: 'Unreviewed'
}

export function toSummaryDto(record: TradeSummaryRecord): TradeSummaryDto {
  const { trade } = record
  return {
    id: trade.id,
    accountId: trade.accountId,
    accountName: record.accountName,
    timezone: record.accountTimezone,
    tradeDate: trade.analyticalTradeDate,
    instrument: trade.instrument,
    // Direction is the persisted fact. It is never inferred from executions.
    direction: trade.direction === 'SHORT' ? 'Short' : 'Long',
    quantity: trade.quantity,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    avgEntry: trade.avgEntryPrice,
    avgExit: trade.avgExitPrice,
    grossPnl: trade.grossPnl,
    commission: trade.commission,
    fees: trade.fees,
    swap: trade.swap,
    netPnl: trade.netPnl,
    plannedR: trade.plannedR,
    realizedR: trade.realizedR,
    strategy: record.strategy,
    compliance: { ...record.counts }
  }
}

/**
 * Trading application service: composes repositories into the list / detail /
 * day views and the small set of writes (notes, rule evaluations) the UI may
 * perform. It knows nothing about Electron or IPC and is tested directly.
 * Trades and executions are read-only here: they are normalized facts owned by
 * ingestion, not editable through this API. Nothing here talks to a broker.
 */
export class TradingService {
  constructor(private readonly db: Database) {}

  // ---- reads -------------------------------------------------------------

  list(request: TradeListRequest = {}): TradeListDto {
    const { accounts, tradeReads } = this.db.repositories
    const filter = {
      ...(request.accountId !== undefined ? { accountId: request.accountId } : {}),
      ...(request.fromDate !== undefined ? { fromDate: request.fromDate } : {}),
      ...(request.toDate !== undefined ? { toDate: request.toDate } : {})
    }
    return {
      accounts: accounts.list({ includeArchived: true }).map((a) => ({
        id: a.id,
        displayName: a.displayName,
        currency: a.currency,
        timezone: a.timezone
      })),
      trades: tradeReads.listSummaries(filter).map(toSummaryDto),
      daysWithNotes: tradeReads
        .listDaysWithNotes(request.accountId !== undefined ? { accountId: request.accountId } : {})
        .map((d) => ({ accountId: d.accountId, date: d.tradeDate }))
    }
  }

  getDetail(tradeId: string): TradeDetailDto {
    const { tradeReads, trades, notes } = this.db.repositories
    const record = tradeReads.getSummary(tradeId)
    if (record === null) throw new ServiceError('NOT_FOUND', 'Trade not found.')
    const trade = record.trade
    const siblings = tradeReads
      .listSummaries({ accountId: trade.accountId, fromDate: trade.analyticalTradeDate, toDate: trade.analyticalTradeDate })
      .map(toSummaryDto)
    return {
      trade: toSummaryDto(record),
      executions: trades.listExecutions(tradeId).map(
        (e): ExecutionDto => ({
          id: e.id,
          executedAt: e.executedAt,
          side: e.side,
          quantity: e.quantity,
          price: e.price,
          commission: e.commission,
          fees: e.fees,
          swap: e.swap
        })
      ),
      strategy: this.strategyDetail(record),
      tradeNote: notes.getTradeNote(tradeId)?.body ?? '',
      dayNote: notes.getDayNote(trade.accountId, trade.analyticalTradeDate)?.body ?? '',
      siblings
    }
  }

  getDay(accountId: string, date: string): DayDto {
    const { accounts, tradeReads, notes } = this.db.repositories
    const account = accounts.getById(accountId)
    if (account === null) throw new ServiceError('NOT_FOUND', 'Account not found.')
    return {
      accountId: account.id,
      accountName: account.displayName,
      timezone: account.timezone,
      date,
      trades: tradeReads.listSummaries({ accountId, fromDate: date, toDate: date }).map(toSummaryDto),
      dayNote: notes.getDayNote(accountId, date)?.body ?? ''
    }
  }

  // ---- writes ------------------------------------------------------------

  updateTradeNote(tradeId: string, body: string): { tradeId: string; body: string } {
    return this.db.transaction(() => {
      if (this.db.repositories.trades.getById(tradeId) === null) {
        throw new ServiceError('NOT_FOUND', 'Trade not found.')
      }
      const note = this.db.repositories.notes.upsertTradeNote(tradeId, body)
      return { tradeId, body: note.body }
    })
  }

  updateDayNote(accountId: string, date: string, body: string): { accountId: string; date: string; body: string } {
    return this.db.transaction(() => {
      if (this.db.repositories.accounts.getById(accountId) === null) {
        throw new ServiceError('NOT_FOUND', 'Account not found.')
      }
      const note = this.db.repositories.notes.upsertDayNote(accountId, date, body)
      return { accountId, date, body: note.body }
    })
  }

  /**
   * Records the trader's judgement of one rule. The rule must belong to the
   * exact Strategy Version the trade is associated with; a rule of any other
   * version (or of a trade with no strategy) is refused, so evaluation history
   * can never drift across versions.
   */
  updateRuleEvaluation(tradeId: string, ruleId: string, state: RuleStateDto): RuleEvaluationResultDto {
    return this.db.transaction(() => {
      const { tradeReads, strategyVersions, evaluations } = this.db.repositories
      const record = tradeReads.getSummary(tradeId)
      if (record === null) throw new ServiceError('NOT_FOUND', 'Trade not found.')
      const versionId = record.trade.strategyVersionId
      if (versionId === null) {
        throw new ServiceError('RULE_VIOLATION', 'This trade is not associated with a strategy version.')
      }
      if (!strategyVersions.listRules(versionId).some((rule) => rule.id === ruleId)) {
        throw new ServiceError(
          'RULE_VIOLATION',
          "That rule does not belong to the strategy version this trade was evaluated against."
        )
      }
      evaluations.setState(tradeId, ruleId, STATE_TO_DB[state])
      const counts: ComplianceCounts = { ...(tradeReads.getSummary(tradeId) as TradeSummaryRecord).counts }
      return { tradeId, ruleId, state, compliance: counts }
    })
  }

  // ---- internals ---------------------------------------------------------

  /** The saved version and the trade's rule results, grouped as the version defined them. */
  private strategyDetail(record: TradeSummaryRecord): TradeStrategyDetailDto | null {
    if (record.strategy === null) return null
    const { strategyVersions, evaluations } = this.db.repositories
    const version = strategyVersions.requireVersion(record.strategy.versionId)
    const groups: EvaluatedGroupDto[] = []
    for (const evaluation of evaluations.listForTrade(record.trade.id)) {
      let group = groups.find((g) => g.groupId === evaluation.ruleGroupId)
      if (group === undefined) {
        group = { groupId: evaluation.ruleGroupId, name: evaluation.ruleGroupName, rules: [] }
        groups.push(group)
      }
      group.rules.push({
        ruleId: evaluation.ruleId,
        name: evaluation.ruleTitle,
        state: STATE_FROM_DB[evaluation.state]
      })
    }
    return { ...record.strategy, publishedAt: version.publishedAt ?? 0, groups }
  }
}
