import type { StrategiesApi } from './strategies'
import type { AccountsApi } from './accounts'
import type { TradesApi } from './trades'
import type { SettingsApi, Language } from './settings'

/** Renderer-visible root object: `window.solidSkill`. Nothing else is exposed. */
export interface SolidSkillApi {
  strategies: StrategiesApi
  trades: TradesApi
  accounts: AccountsApi
  settings: SettingsApi
  /** The language resolved at window creation, read once via a synchronous
   *  preload-time IPC call so i18next can be initialized before first paint.
   *  Not a live value — use `settings` for anything after startup. */
  initialLanguage: Language
}
