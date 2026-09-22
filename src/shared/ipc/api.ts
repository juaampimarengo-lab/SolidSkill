import type { StrategiesApi } from './strategies'
import type { AccountsApi } from './accounts'
import type { TradesApi } from './trades'

/** Renderer-visible root object: `window.solidSkill`. Nothing else is exposed. */
export interface SolidSkillApi {
  strategies: StrategiesApi
  trades: TradesApi
  accounts: AccountsApi
}
