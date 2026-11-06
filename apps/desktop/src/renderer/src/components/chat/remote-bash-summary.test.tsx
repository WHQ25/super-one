/** @vitest-environment jsdom */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import type { ChatMessage } from '@superone/shared/agent-types'
import { projectWindowMessage } from '@superone/runtime/stream/delivery/window-projection'
import { DetailViews } from '@superone/runtime/stream/delivery/projection'
import { createDetailClient, type DetailTransport } from '@superone/chat-core'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { turnDisplayContent } from '@superone/chat-view/presenters/turn-content'
import { TurnBlockPresenter, type TurnBodyPresenterParts, type TurnBodyPresenterRuntime } from './presenters/TurnBody'

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({ toolRenderers: {}, activeProject: '/proj', projectSessions: {} }),
  useActiveSession: (selector: (state: unknown) => unknown) => selector({
    cwd: '/proj', homedir: '/Users/test', _streamingToolInputPreviews: {}, taskProgress: {}, pendingPermissions: [],
  }),
  useBashOutput: () => undefined,
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ mcpMeta: {}, mcpLibrary: [] }),
}))
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: (selector: (state: unknown) => unknown) => selector({ apps: [] }),
}))

const { ToolBlock } = await import('./ToolBlock')
const { default: remoteSummaryStories } = await import('./BashRemoteSummary.stories')
const RemoteSummaryPreview = remoteSummaryStories.component
const Empty = () => null
const parts: TurnBodyPresenterParts = {
  Tool: ToolBlock, Text: Empty, Insight: Empty, Document: Empty, Reasoning: Empty,
  Subagent: Empty, Workflow: Empty, Plan: Empty, ToolGroup: Empty, AppToolGroup: Empty,
  TurnDetail: Empty, Fold: Empty,
}
const runtime: TurnBodyPresenterRuntime = {
  isBackgroundTool: () => false, isPinnedSegment: () => false, isHiddenTool: () => false,
  summarizeProcess: () => ({ toolCalls: 0, filesChanged: 0, added: 0, removed: 0 }),
}

function renderRemote(surface: 'desktop' | 'phone', command: string, description?: string) {
  const source: ChatMessage = {
    id: 'turn', role: 'assistant', providerId: 'claude', status: 'complete', createdAt: '',
    content: [
      { type: 'tool_use', toolName: 'Bash', toolUseId: 'bash', input: JSON.stringify({ command, description, timeout: 120000 }), status: 'complete' },
      { type: 'tool_result', toolUseId: 'bash', summary: 'Finished extracting assets' },
    ],
  }
  const projected = projectWindowMessage(source)
  const tool = projected.content.find(block => 'toolName' in block)
  if (!tool || !('toolName' in tool)) throw new Error('Missing projected tool')
  const views = new DetailViews()
  views.open('session')
  const subscribe = vi.fn<DetailTransport['subscribe']>(async (target, id) => views.subscribe('session', id, target.detailRef, source))
  const client = createDetailClient({ subscribe, unsubscribe: () => {} }, { newId: () => crypto.randomUUID() })
  const view = render(<DetailScopeProvider scope={{ client, environmentId: 'node', sessionId: 'session' }}>
    {surface === 'phone'
      ? <PortableMessage message={projected} scheme="dark" pendingPermission={null} />
      : turnDisplayContent(projected).map((block, index) => <TurnBlockPresenter key={index} block={block} index={index}
        isStreaming={false} parts={parts} runtime={runtime} />)}
  </DetailScopeProvider>)
  const header = view.container.querySelector('.tool-node > div') as HTMLElement
  return { ...view, tool, header, subscribe }
}

describe.each(['desktop', 'phone'] as const)('remote Bash summaries on %s', (surface) => {
  it('shows a short command description without fetching details', () => {
    const { header, subscribe } = renderRemote(surface, 'ls -la', 'List workspace files')
    expect(header).toHaveTextContent('List workspace files')
    expect(subscribe).not.toHaveBeenCalled()
  })

  it.each([true, false])('keeps a long command readable before and after expansion (description: %s)', async (withDescription) => {
    const command = `python3 -c "${'print(1);'.repeat(200)}"`
    const description = withDescription ? 'Extract native exit, information and ctrl-key logo' : undefined
    const summary = description ?? command.slice(0, 160)
    const { container, tool, header, subscribe } = renderRemote(surface, command, description)
    expect(tool.input).toBe('{}')
    expect(tool.toolSummary).toBe(summary)
    expect(header).toHaveTextContent(summary)
    expect(subscribe).not.toHaveBeenCalled()
    expect(container.querySelector('.bg-terminal-bg')).toBeNull()

    await act(async () => { fireEvent.click(header) })
    await waitFor(() => expect(container).toHaveTextContent('Finished extracting assets'))
    expect(container.querySelector('.bg-terminal-bg')).not.toBeNull()
    expect(container).toHaveTextContent(command)
    expect(header).toHaveTextContent('120s')
    expect(subscribe).toHaveBeenCalledTimes(1)
    if (description) expect(header).toHaveTextContent(description)

    await act(async () => { fireEvent.click(header) })
    expect(header).toHaveTextContent(summary)
  })
})

describe('remote Bash summary stories', () => {
  it.each([
    ['light', 'en'], ['dark', 'en'], ['light', 'zh'], ['dark', 'zh'],
  ] as const)('keeps both narrow headers readable in %s / %s', async (scheme, locale) => {
    const previous = i18n.language
    await i18n.changeLanguage(locale)
    const view = render(<RemoteSummaryPreview scheme={scheme} width={320} />)
    try {
      const headers = view.container.querySelectorAll('[data-bash-preview] .tool-node > div:first-child')
      expect(headers).toHaveLength(2)
      for (const header of headers) expect(header).toHaveTextContent('Extract native exit, information and ctrl-key logo')
    } finally {
      view.unmount()
      await i18n.changeLanguage(previous)
    }
  })

  it.each(['loading', 'retry'] as const)('preserves both summaries while details are %s', async (detailState) => {
    const { container } = render(<RemoteSummaryPreview detailState={detailState} />)
    for (const section of container.querySelectorAll<HTMLElement>('[data-bash-preview]')) {
      const header = section.querySelector<HTMLElement>('.tool-node > div')!
      await act(async () => { fireEvent.click(header) })
      expect(header).toHaveTextContent('Extract native exit, information and ctrl-key logo')
      if (detailState === 'loading') {
        await waitFor(() => expect(section).toHaveTextContent('Loading'))
      } else {
        await waitFor(() => expect(section).toHaveTextContent('Unable to load details'))
        await act(async () => { fireEvent.click(section.querySelector('button')!) })
        await waitFor(() => expect(section).toHaveTextContent('Finished extracting assets'))
        expect(header).toHaveTextContent('Extract native exit, information and ctrl-key logo')
      }
    }
  })
})
