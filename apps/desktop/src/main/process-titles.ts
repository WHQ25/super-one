export const ProcessTitle = {
  Claude: 'SuperOne Claude',
  Codex: 'SuperOne Codex',
  Mdns: 'SuperOne mDNS',
  SleepBlocker: 'SuperOne Sleep Blocker',
  Installer: 'SuperOne Installer',
  MainWindow: 'SuperOne Main Window',
  MiniWindow: 'SuperOne Mini Window',
  MiniAppDev: 'SuperOne MiniApp Dev',
} as const

export const SUPERONE_ROLE_ARG_PREFIX = '--superone-role='

export const WindowRole = {
  Main: 'main',
  Mini: 'mini',
} as const

export type WindowRoleValue = (typeof WindowRole)[keyof typeof WindowRole]

export function roleArg(role: WindowRoleValue): string {
  return `${SUPERONE_ROLE_ARG_PREFIX}${role}`
}

export function titleForRole(role: string | undefined): string | null {
  if (role === WindowRole.Main) return ProcessTitle.MainWindow
  if (role === WindowRole.Mini) return ProcessTitle.MiniWindow
  return null
}
