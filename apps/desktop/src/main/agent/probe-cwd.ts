import { app } from 'electron'

export function resolveProbeCwd(): string {
  return app.getPath('userData')
}
