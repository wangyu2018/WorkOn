import type { WorkOnApi } from './index'

declare global {
  interface Window {
    api: WorkOnApi
  }
}

export {}
