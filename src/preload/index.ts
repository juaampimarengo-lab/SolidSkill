// The renderer's ONLY bridge to the main process. It exposes a fixed,
// application-level Strategy API — no raw ipcRenderer, no generic channel
// access, no filesystem/process/SQL. Each method invokes exactly one named
// channel and returns the main process's serializable IpcResult.
import { contextBridge, ipcRenderer } from 'electron'
import type { SolidSkillApi } from '../shared/ipc/api'
import { STRATEGY_CHANNELS } from '../shared/ipc/strategies'
import { TRADE_CHANNELS } from '../shared/ipc/trades'

const C = STRATEGY_CHANNELS
const T = TRADE_CHANNELS

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
    updateRuleEvaluation: (request) => ipcRenderer.invoke(T.updateRuleEvaluation, request)
  }
}

contextBridge.exposeInMainWorld('solidSkill', api)
