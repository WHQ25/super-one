export const ProcessTitle = {
  Claude: 'SuperOne Claude',
  Codex: 'SuperOne Codex',
  Mdns: 'SuperOne mDNS',
  SleepBlocker: 'SuperOne Sleep Blocker',
  Installer: 'SuperOne Installer',
  MainWindow: 'SuperOne Main Window',
  MiniWindow: 'SuperOne Mini Window',
  MiniAppDev: 'SuperOne MiniApp Dev',
  WorkerHost: 'SuperOne Worker Host',
} as const

export const SUPERONE_ROLE_ARG_PREFIX = '--superone-role='

export const SUPERONE_GLASS_ARG = '--superone-liquid-glass'

export function glassBootArgs(enabled: boolean): string[] {
  return enabled ? [SUPERONE_GLASS_ARG] : []
}

export const WindowRole = {
  Main: 'main',
  Mini: 'mini',
  WorkerHost: 'worker-host',
} as const

export type WindowRoleValue = (typeof WindowRole)[keyof typeof WindowRole]

export function roleArg(role: WindowRoleValue): string {
  return `${SUPERONE_ROLE_ARG_PREFIX}${role}`
}

export function titleForRole(role: string | undefined): string | null {
  if (role === WindowRole.Main) return ProcessTitle.MainWindow
  if (role === WindowRole.Mini) return ProcessTitle.MiniWindow
  if (role === WindowRole.WorkerHost) return ProcessTitle.WorkerHost
  return null
}
