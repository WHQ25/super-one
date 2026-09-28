import type { MiniAppToolPreviewRequest } from '@superone/shared/miniapp-types'
import { miniAppPreviewTargetId } from '@superone/shared/miniapp-automation-target'
import { useAppStore } from '@/stores/app'
import { projectIdForDir } from './use-miniapp-project-scope'
import { useToolUiPreviewStore } from '@/stores/miniapp-tool-preview'
import { isSessionDockOnScreen, markMiniAppTargetStale, requireProjectDir, resolveMiniAppTarget } from './miniapp-automation-targets'

/**
 * `miniapp_dev_preview`: render the fixture, then wait until the preview view is
 * loaded so the returned target id is immediately usable by `browser_*` tools.
 */
export async function showToolUiPreview(sessionId: string, request: MiniAppToolPreviewRequest, signal?: AbortSignal) {
  const projectDir = requireProjectDir(sessionId)
  // The preview tab lives in the dock, which shows the user's current session.
  if (!isSessionDockOnScreen(sessionId)) throw new Error('This session runs in the background; the tool UI preview opens in the workspace the user is viewing. Ask the user to switch to this session.')
  const target = miniAppPreviewTargetId(request.appId)
  markMiniAppTargetStale(target, projectDir)
  useToolUiPreviewStore.getState().show({
    ...request,
    projectDir,
    projectId: projectIdForDir(useAppStore.getState(), projectDir),
  })
  // Revealing opens the dock tab; waiting covers the WebView's first load.
  await resolveMiniAppTarget(target, sessionId, signal)
  return { target, tool: request.tool, phase: request.phase }
}
