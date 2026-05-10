export const NO_PROJECT_KEY = '00000000-0000-0000-0000-000000000000'

export function buildMiniAppHost(appId: string, projectId: string | null | undefined): string {
  return `${appId}.${projectId ?? NO_PROJECT_KEY}`
}
