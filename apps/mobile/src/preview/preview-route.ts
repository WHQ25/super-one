import type { HarnessId } from '@superone/shared/agent-types'
import { isKnownEffortLevel } from '@superone/shared/effort-labels'
import { HARNESS_DEFAULT_BRAND_HUE } from '@superone/shared/harness-brand'
import { nativeScenarios } from './scenarios'

export const shellPreviewPages = ['New session', 'Chat', 'Project', 'Add project', 'Worktree', 'Branch', 'Icons', 'Git indicators', 'Chip editor', 'Devices', 'Pairing', 'Projects', 'Sessions', 'Settings', 'Files', 'Computer files', 'File search', 'Go to folder', 'Empty folder', 'Folder error', 'Terminal', 'LAN browser', 'Tool catalog'] as const
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
      if (!page) return null
      // `effort` reaches states that are otherwise three taps deep and reset on
      // every reload — the two Claude easter eggs above all.
      const effort = url.searchParams.get('effort')
      if (effort && !isKnownEffortLevel(effort)) return null
      return { kind: 'shell' as const, page, harness: harness as HarnessId, theme: theme as 'light' | 'dark', effort: effort ?? undefined }
    }
    return null
  } catch { return null }
}

export type PreviewRoute = NonNullable<ReturnType<typeof parsePreviewRoute>> & { revision: number }
