import { app, ipcMain } from 'electron'
import {
  ANTIGRAVITY_AUTH_CHANNEL,
  type AntigravityAuthRequest,
} from '@superone/shared/antigravity-auth'
import { AntigravityAuthService } from './antigravity-auth-service'

const VALID_ACTIONS = new Set([
  'status',
  'refresh',
  'configure',
  'start',
  'submitCallback',
  'cancel',
  'logout',
])

export function registerAntigravityAuthIpc(): void {
  const service = new AntigravityAuthService()
  ipcMain.handle(ANTIGRAVITY_AUTH_CHANNEL, (_event, request: AntigravityAuthRequest) => {
    if (!request || !VALID_ACTIONS.has(request.action)) {
      throw new Error('Invalid Antigravity authentication action')
    }
    if (
      (request.action === 'submitCallback' || request.action === 'cancel') &&
      typeof request.loginId !== 'string'
    ) {
      throw new Error('Missing Antigravity login attempt ID')
    }
    if (request.action === 'submitCallback' && typeof request.callbackUrl !== 'string') {
      throw new Error('Invalid Antigravity callback URL')
    }
    return service.handle(request)
  })
  app.on('before-quit', () => {
    void service.stop()
  })
}
