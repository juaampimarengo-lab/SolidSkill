// The renderer's ONLY bridge to the main process. It exposes a fixed,
// application-level Strategy API — no raw ipcRenderer, no generic channel
// access, no filesystem/process/SQL. Each method invokes exactly one named
// channel and returns the main process's serializable IpcResult.
import { contextBridge, ipcRenderer } from 'electron'
import { STRATEGY_CHANNELS } from '../shared/ipc/strategies'
import type { SolidSkillApi } from '../shared/ipc/strategies'

const C = STRATEGY_CHANNELS

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
  }
}

contextBridge.exposeInMainWorld('solidSkill', api)
