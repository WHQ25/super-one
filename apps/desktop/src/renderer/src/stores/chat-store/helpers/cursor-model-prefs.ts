import type { ModelOption } from '@superone/shared/agent-types'
import { defaultCursorModelParams } from '@superone/cursor/cursor-model-selection'
import type { CursorModelParamsByModel } from '@superone/cursor/cursor-config'

let cache: CursorModelParamsByModel = {}
let loadPromise: Promise<void> | null = null

/**
 * Load harness-scoped Cursor model params from cursor-base provider config.
 */
export async function ensureCursorHarnessModelPrefsLoaded(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const config = await window.app.getCursorBaseConfig()
      cache = { ...(config.modelParamsByModel ?? {}) }
    } catch {
      cache = {}
    }
  })()
  return loadPromise
}

/**
 * Resolve params for a model from harness prefs, else catalog defaults.
 */
export function resolveCursorHarnessModelParams(
  modelId: string,
  catalogModel: Pick<ModelOption, 'parameters'> | null | undefined,
): Record<string, string> {
  const remembered = cache[modelId]
  if (remembered && Object.keys(remembered).length > 0) return { ...remembered }
  return defaultCursorModelParams(catalogModel)
}

/**
 * Persist one model's params into cursor-base harness config (global across sessions).
 */
export function persistCursorHarnessModelParams(
  modelId: string,
  params: Record<string, string>,
): void {
  if (!modelId) return
  cache = { ...cache, [modelId]: { ...params } }
  void window.app.updateCursorBaseConfig({
    model: modelId,
    modelParamsByModel: { [modelId]: { ...params } },
  }).catch((err) => {
    console.warn('[cursor-model-prefs] persist failed:', err)
  })
}
