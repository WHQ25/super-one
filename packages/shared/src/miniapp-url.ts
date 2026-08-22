export const NO_PROJECT_KEY = '00000000-0000-0000-0000-000000000000'

export function buildMiniAppUrlHost(appId: string, projectId: string | null | undefined): string {
  return `${appId}.${projectId ?? NO_PROJECT_KEY}`
}

export function parseMiniAppUrlHost(host: string): { appId: string; projectId: string } {
  const idx = host.indexOf('.')
  if (idx < 0) return { appId: host, projectId: NO_PROJECT_KEY }
  return { appId: host.slice(0, idx), projectId: host.slice(idx + 1) }
}
