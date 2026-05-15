/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const stubs: Record<string, () => null> = {}
  for (const key of Object.keys(actual)) stubs[key] = () => null
  return stubs
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { toolRenderers: Record<string, never>; activeProject: string | null }) => unknown) =>
    selector({ toolRenderers: {}, activeProject: '/proj' }),
  useActiveSession: (selector: (state: { cwd: string; homedir: string; _streamingToolInputPreviews: Record<string, never> }) => unknown) =>
    selector({ cwd: '/proj', homedir: '/Users/test', _streamingToolInputPreviews: {} }),
  useBashOutput: () => ({ chunks: [], completed: true }),
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: { mcpMeta: Record<string, never>; mcpLibrary: never[] }) => unknown) =>
    selector({ mcpMeta: {}, mcpLibrary: [] }),
}))

vi.mock('@/stores/source-control', () => ({
  useSourceControlStore: () => ({}),
}))

// Reactive miniapp store mock — flips `apps` mid-test to simulate the async
// fetchApps that happens via AppSidebar's useEffect after window-reopen.
const miniAppState: { apps: MiniAppEntry[] } = { apps: [] }
const miniAppListeners = new Set<() => void>()
function setMiniAppApps(apps: MiniAppEntry[]) {
  miniAppState.apps = apps
  for (const cb of miniAppListeners) cb()
}
vi.mock('@/stores/miniapp', () => {
  const useMiniAppStore = <T,>(selector: (s: typeof miniAppState) => T): T => {
    const { useSyncExternalStore } = require('react')
    return useSyncExternalStore(
      (cb: () => void) => { miniAppListeners.add(cb); return () => miniAppListeners.delete(cb) },
      () => selector(miniAppState),
    )
  }
  useMiniAppStore.getState = () => miniAppState
  return { useMiniAppStore }
})

vi.mock('@/components/miniapp/MiniAppIcon', () => ({
  MiniAppIcon: () => null,
}))

vi.mock('@/lib/stall-utils', () => ({
  useStallLevel: () => 0,
  getStallColor: () => '',
}))

// Replace the real StandaloneToolBlock with a sentinel so the test asserts
// only on whether the branch was taken (not on iframe internals).
vi.mock('./StandaloneToolBlock', () => ({
  StandaloneToolBlock: () => <div data-testid="standalone-iframe" />,
}))

Object.defineProperty(window, 'app', {
  value: { trace: vi.fn() },
  configurable: true,
})

const { ToolBlock } = await import('./ToolBlock')

const demoApp: MiniAppEntry = {
  id: 'demo',
  type: 'installed',
  source: 'system',
  installDir: '/apps/demo',
  distDir: '/apps/demo',
  manifest: {
    appId: 'demo',
    name: 'Demo',
    version: '0.0.1',
    tools: [
      { name: 'increment', standalone: true, renderer: { result: { template: 'result' } } },
    ],
    templates: { result: 'result.html' },
  },
  manifestSource: 'installed',
} as unknown as MiniAppEntry

describe('ToolBlock standalone re-render after async apps load', () => {
  it('switches from fallback to StandaloneToolBlock when miniapp store finishes loading', () => {
    setMiniAppApps([]) // start with apps still loading (window-reopen race)

    render(
      <ToolBlock
        toolName="mcp__superone__demo__increment"
        toolUseId="toolu_x"
        input={JSON.stringify({ by: 1 })}
        status="complete"
        result='{"value":1}'
      />,
    )

    expect(screen.queryByTestId('standalone-iframe')).toBeNull()

    act(() => { setMiniAppApps([demoApp]) })

    expect(screen.getByTestId('standalone-iframe')).not.toBeNull()
  })
})
