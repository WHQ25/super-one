import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_DEFAULT_BRAND_HUE } from '@superone/shared/harness-brand'
import { nativeScenarios } from './scenarios'

export const shellPreviewPages = ['New session', 'Chat', 'Icons', 'Chip editor', 'Devices', 'Pairing', 'Projects', 'Sessions', 'Settings', 'Files', 'Empty folder', 'Folder error', 'Terminal', 'Tool catalog'] as const
export type ShellPreviewPage = typeof shellPreviewPages[number]

export function parsePreviewRoute(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'superone:' || url.hostname !== 'native-preview') return null
    const harness = url.searchParams.get('harness') ?? 'claude'
    if (!Object.hasOwn(HARNESS_DEFAULT_BRAND_HUE, harness)) return null
    const theme = url.searchParams.get('theme') ?? 'light'
    if (theme !== 'light' && theme !== 'dark') return null
    const scenarioId = url.searchParams.get('scenario')
    const pageName = url.searchParams.get('page')
    if (scenarioId && pageName) return null
    if (scenarioId) {
      const scenario = nativeScenarios.find((item) => item.id === scenarioId)
      return scenario ? { kind: 'scenario' as const, scenario, harness: harness as HarnessId, theme: theme as 'light' | 'dark' } : null
    }
    if (pageName) {
      const page = shellPreviewPages.find((item) => item === pageName)
      return page ? { kind: 'shell' as const, page, harness: harness as HarnessId, theme: theme as 'light' | 'dark' } : null
    }
    return null
  } catch { return null }
}

export type PreviewRoute = NonNullable<ReturnType<typeof parsePreviewRoute>> & { revision: number }
