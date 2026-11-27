import { ipcMain } from 'electron'
import {
  ANTIGRAVITY_AUTH_CHANNEL,
  type AntigravityAuthRequest,
} from '@superone/shared/antigravity-auth'
import { AntigravityAuthService } from './antigravity-auth-service'

export function registerAntigravityAuthIpc(): void {
  const service = new AntigravityAuthService()
  ipcMain.handle(ANTIGRAVITY_AUTH_CHANNEL, (_event, request: AntigravityAuthRequest) =>
    service.handle(request),
  )
}
