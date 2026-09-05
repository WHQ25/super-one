import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_DEFAULT_BRAND_HUE } from '@superone/shared/harness-brand'
import { nativeScenarios } from './scenarios'

export function parsePreviewRoute(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'superone:' || url.hostname !== 'native-preview') return null
    const scenario = nativeScenarios.find((item) => item.id === url.searchParams.get('scenario'))
    if (!scenario) return null
    const harness = url.searchParams.get('harness') ?? 'claude'
    if (!Object.hasOwn(HARNESS_DEFAULT_BRAND_HUE, harness)) return null
    const theme = url.searchParams.get('theme') ?? 'light'
    if (theme !== 'light' && theme !== 'dark') return null
    return { scenario, harness: harness as HarnessId, theme: theme as 'light' | 'dark' }
  } catch { return null }
}

export type PreviewRoute = NonNullable<ReturnType<typeof parsePreviewRoute>> & { revision: number }
