import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, intOrNull, str } from '../sql'
import type { EvaluationState, RuleKind, TradeRuleEvaluationDetail } from '../types'

function toDetail(row: Row): TradeRuleEvaluationDetail {
  return {
    id: str(row['id']),
    tradeId: str(row['trade_id']),
    strategyVersionId: str(row['strategy_version_id']),
    ruleId: str(row['rule_id']),
    state: str(row['state']) as EvaluationState,
    evaluatedAt: intOrNull(row['evaluated_at']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at']),
    ruleTitle: str(row['rule_title']),
    ruleDescription: str(row['rule_description']),
    ruleKind: str(row['rule_kind']) as RuleKind,
    rulePosition: int(row['rule_position']),
    ruleGroupId: str(row['rule_group_id']),
    ruleGroupName: str(row['rule_group_name']),
    ruleGroupPosition: int(row['rule_group_position'])
  }
}

/** One (trade, rule) evaluation in an account/date range, with its exact version's wording. */
export interface AccountRangeEvaluation {
  tradeId: string
  ruleId: string
  state: EvaluationState
  strategyVersionId: string
  versionNumber: number
  strategyId: string
  strategyName: string
  ruleTitle: string
  ruleGroupId: string
  ruleGroupName: string
}

/**
 * Trade Rule Evaluations. Rule wording is always resolved through the rule
 * row the evaluation points at, which belongs to the exact evaluated
 * version, never through the Strategy's current version.
 */
export class EvaluationRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  /** Evaluations of a trade with their frozen rule/group wording, in rule-workflow order. */
  listForTrade(tradeId: string): TradeRuleEvaluationDetail[] {
    return this.sql
      .all(
        `SELECT e.*, r.title AS rule_title, r.description AS rule_description, r.kind AS rule_kind,
                r.position AS rule_position, g.id AS rule_group_id, g.name AS rule_group_name,
                g.position AS rule_group_position
         FROM trade_rule_evaluations e
         JOIN rules r ON r.id = e.rule_id AND r.strategy_version_id = e.strategy_version_id
         JOIN rule_groups g ON g.id = r.rule_group_id
         WHERE e.trade_id = ?
         ORDER BY g.position, g.id, r.position, r.id`,
        [tradeId]
      )
      .map(toDetail)
  }

  /**
   * Every rule evaluation of one account's Trades whose analytical date is in
   * [fromDate, toDate], with the rule/group wording of the EXACT version each
   * Trade was evaluated against (never the Strategy's current version) and the
   * Strategy's current display name. One set-based query; read-only.
   */
  listForAccountRange(accountId: string, fromDate: string, toDate: string): AccountRangeEvaluation[] {
    return this.sql
      .all(
        `SELECT e.trade_id, e.rule_id, e.state, e.strategy_version_id,
                r.title AS rule_title, g.id AS rule_group_id, g.name AS rule_group_name,
                v.version_number, s.id AS strategy_id, s.name AS strategy_name
         FROM trade_rule_evaluations e
         JOIN trades t ON t.id = e.trade_id
         JOIN rules r ON r.id = e.rule_id AND r.strategy_version_id = e.strategy_version_id
         JOIN rule_groups g ON g.id = r.rule_group_id
         JOIN strategy_versions v ON v.id = e.strategy_version_id
         JOIN strategies s ON s.id = v.strategy_id
         WHERE t.account_id = ? AND t.analytical_trade_date >= ? AND t.analytical_trade_date <= ?
         ORDER BY s.name, s.id, v.version_number, g.position, g.id, r.position, r.id,
                  t.analytical_trade_date, t.opened_at, t.id`,
        [accountId, fromDate, toDate]
      )
      .map((row) => ({
        tradeId: str(row['trade_id']),
        ruleId: str(row['rule_id']),
        state: str(row['state']) as EvaluationState,
        strategyVersionId: str(row['strategy_version_id']),
        versionNumber: int(row['version_number']),
        strategyId: str(row['strategy_id']),
        strategyName: str(row['strategy_name']),
        ruleTitle: str(row['rule_title']),
        ruleGroupId: str(row['rule_group_id']),
        ruleGroupName: str(row['rule_group_name'])
      }))
  }

  /**
   * Records the trader's judgement for one rule of the trade's associated
   * version. Enforces evaluation.rule.version == trade.strategy_version: the
   * evaluation must exist for this (trade, rule) AND both its version and its
   * rule's version must equal the trade's associated version. (The schema's
   * composite foreign keys already make anything else unrepresentable; this
   * turns a violation into a clear error before it reaches SQLite.)
   */
  setState(tradeId: string, ruleId: string, state: EvaluationState): void {
    const at = BigInt(this.now())
    const existing = this.sql.get(
      `SELECT e.id FROM trade_rule_evaluations e
         JOIN trades t ON t.id = e.trade_id
         JOIN rules r ON r.id = e.rule_id
        WHERE e.trade_id = ? AND e.rule_id = ?
          AND e.strategy_version_id = t.strategy_version_id
          AND r.strategy_version_id = t.strategy_version_id`,
      [tradeId, ruleId]
    )
    if (existing === undefined) {
      throw new Error(`No evaluation for trade ${tradeId} and rule ${ruleId} in the trade's strategy version`)
    }
    this.sql.run(
      `UPDATE trade_rule_evaluations SET state = ?, evaluated_at = ?, updated_at = ?
       WHERE trade_id = ? AND rule_id = ?`,
      [state, state === 'UNREVIEWED' ? null : at, at, tradeId, ruleId]
    )
  }
}
