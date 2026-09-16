import { app, ipcMain } from 'electron'
import { GROK_AUTH_CHANNEL, type GrokAuthRequest } from '@superone/shared/grok-auth'
import { GrokAuthService } from './grok-auth-service'

export function registerGrokAuthIpc(): void {
  const service = new GrokAuthService()
  ipcMain.handle(GROK_AUTH_CHANNEL, (_event, request: GrokAuthRequest) => {
    if (!request || !['status', 'refresh', 'start', 'submit', 'cancel'].includes(request.action)) {
      throw new Error('Invalid Grok authentication action')
    }
    if ((request.action === 'submit' || request.action === 'cancel') && typeof request.loginId !== 'string') {
      throw new Error('Missing Grok login attempt')
    }
    if (request.action === 'submit' && typeof request.code !== 'string') throw new Error('Invalid login code')
    return service.handle(request)
  })
  app.on('before-quit', () => { void service.stop() })
}
