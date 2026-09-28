/**
 * Agent-facing ids for development mini-app WebViews that `browser_*` tools can
 * drive. They sit in the same `tab` parameter as browser tab ids and are scoped
 * to the calling session's project, so they carry no project component.
 */
export const MINIAPP_TARGET_PREFIX = 'miniapp:'

export type MiniAppTargetKind = 'panel' | 'preview' | 'tool'

export function isMiniAppTargetId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(MINIAPP_TARGET_PREFIX)
}

export function miniAppPanelTargetId(appId: string): string {
  return `${MINIAPP_TARGET_PREFIX}${appId}`
}

export function miniAppPreviewTargetId(appId: string): string {
  return `${MINIAPP_TARGET_PREFIX}${appId}:preview`
}

export function miniAppToolTargetId(appId: string, toolUseId: string): string {
  return `${MINIAPP_TARGET_PREFIX}${appId}:tool:${toolUseId}`
}
