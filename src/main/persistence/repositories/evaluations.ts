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

  /** Records the trader's judgement for one rule of the trade's associated version. */
  setState(tradeId: string, ruleId: string, state: EvaluationState): void {
    const at = BigInt(this.now())
    const existing = this.sql.get(
      'SELECT id FROM trade_rule_evaluations WHERE trade_id = ? AND rule_id = ?',
      [tradeId, ruleId]
    )
    if (existing === undefined) {
      throw new Error(`No evaluation for trade ${tradeId} and rule ${ruleId}`)
    }
    this.sql.run(
      `UPDATE trade_rule_evaluations SET state = ?, evaluated_at = ?, updated_at = ?
       WHERE trade_id = ? AND rule_id = ?`,
      [state, state === 'UNREVIEWED' ? null : at, at, tradeId, ruleId]
    )
  }
}
