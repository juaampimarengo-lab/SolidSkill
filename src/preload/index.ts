// The renderer's ONLY bridge to the main process. It exposes a fixed,
// application-level Strategy API — no raw ipcRenderer, no generic channel
// access, no filesystem/process/SQL. Each method invokes exactly one named
// channel and returns the main process's serializable IpcResult.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { SolidSkillApi } from '../shared/ipc/api'
import { STRATEGY_CHANNELS } from '../shared/ipc/strategies'
import { ACCOUNT_CHANNELS } from '../shared/ipc/accounts'
import { TRADE_CHANNELS, TRADE_DATA_CHANGED_CHANNEL, type TradingDataChangedDto } from '../shared/ipc/trades'
import { SETTINGS_CHANNELS, SETTINGS_LANGUAGE_SYNC_CHANNEL, isLanguage, type Language } from '../shared/ipc/settings'

const C = STRATEGY_CHANNELS
const T = TRADE_CHANNELS
const A = ACCOUNT_CHANNELS
const S = SETTINGS_CHANNELS

// Read once, synchronously, before any renderer script runs, so i18next can
// be initialized with the correct language on the very first paint — no
// flash back to English while the async settings API resolves. The only
// synchronous IPC call in the app; everything else is invoke/async.
const initialLanguageRaw: unknown = ipcRenderer.sendSync(SETTINGS_LANGUAGE_SYNC_CHANNEL)
const initialLanguage: Language = isLanguage(initialLanguageRaw) ? initialLanguageRaw : 'en'

const api: SolidSkillApi = {
  strategies: {
    list: () => ipcRenderer.invoke(C.list),
    create: (input) => ipcRenderer.invoke(C.create, input),
    updateDetails: (input) => ipcRenderer.invoke(C.updateDetails, input),
    archive: (strategyId) => ipcRenderer.invoke(C.archive, strategyId),
    restore: (strategyId) => ipcRenderer.invoke(C.restore, strategyId),
    deleteUnpublished: (strategyId) => ipcRenderer.invoke(C.deleteUnpublished, strategyId),
    beginDraft: (strategyId) => ipcRenderer.invoke(C.beginDraft, strategyId),
    discardDraft: (strategyId) => ipcRenderer.invoke(C.discardDraft, strategyId),
    editDraft: (input) => ipcRenderer.invoke(C.editDraft, input),
    publishDraft: (strategyId) => ipcRenderer.invoke(C.publishDraft, strategyId)
  },
  trades: {
    list: (request) => ipcRenderer.invoke(T.list, request),
    getDetail: (tradeId) => ipcRenderer.invoke(T.getDetail, tradeId),
    getDay: (request) => ipcRenderer.invoke(T.getDay, request),
    updateTradeNote: (request) => ipcRenderer.invoke(T.updateTradeNote, request),
    updateDayNote: (request) => ipcRenderer.invoke(T.updateDayNote, request),
    updateRuleEvaluation: (request) => ipcRenderer.invoke(T.updateRuleEvaluation, request),
    onDataChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, payload: TradingDataChangedDto): void => listener(payload)
      ipcRenderer.on(TRADE_DATA_CHANGED_CHANNEL, handler)
      return () => ipcRenderer.removeListener(TRADE_DATA_CHANGED_CHANNEL, handler)
    }
  },
  accounts: {
    list: () => ipcRenderer.invoke(A.list),
    setActive: (accountId) => ipcRenderer.invoke(A.setActive, accountId)
  },
  settings: {
    getLanguage: () => ipcRenderer.invoke(S.getLanguage),
    setLanguage: (language) => ipcRenderer.invoke(S.setLanguage, language)
  },
  initialLanguage
}

contextBridge.exposeInMainWorld('solidSkill', api)
