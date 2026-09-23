/// <reference types="vite/client" />
import type { VibeVaultApi } from '../../preload/api'

declare global {
  interface Window {
    vv: VibeVaultApi
  }
}
