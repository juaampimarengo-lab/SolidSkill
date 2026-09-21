import type { SolidSkillApi } from '../shared/ipc/api'

declare global {
  interface Window {
    /** Application-level API exposed by the preload script. See docs/IPC_CONTRACT.md. */
    solidSkill: SolidSkillApi
  }
}

export {}
