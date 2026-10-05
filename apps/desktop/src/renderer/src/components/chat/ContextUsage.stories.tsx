import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { HarnessId } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { ContextUsage } from './ContextUsage'

mockIpc('app', 'getModelCatalog', async () => ({ providers: [], generatedAt: '2026-10-05', source: 'snapshot' }))
mockIpc('agent', 'resetSession', async () => null)
mockIpc('agent', 'prewarm', async () => undefined)
mockIpc('app', 'codexListSkills', async () => [])

const PROJECT = '/storybook/context-usage'
const SID = 'context-usage'
const HARNESSES: HarnessId[] = ['claude', 'codex', 'opencode', 'cursor', 'dsh', 'acp']

function ContextUsagePreview({
  tokens = 0,
  switchHarness = false,
  detailed = false,
  narrow = false,
}: {
  tokens?: number
  switchHarness?: boolean
  detailed?: boolean
  narrow?: boolean
}) {
  const [ready, setReady] = useState(false)
  const provider = useChatStore((state) => state.projectSessions[PROJECT]?._sessions[SID]?.sessionProvider)
  useEffect(() => {
    const { activeProject, projectSessions, initializedHarnesses } = useChatStore.getState()
    const session = {
      ...createDefaultPerSessionState(),
      preferredProvider: 'acp' as const,
      sessionProvider: 'acp' as const,
      acpAgentId: 'grok-build',
      acpModels: [{ id: 'grok-4.6', name: 'Grok 4.6', description: '', contextWindow: 500_000 }],
      acpModelsStatus: 'ready' as const,
      selectedModel: 'grok-4.6',
      detailedUsage: detailed ? {
        totalTokens: tokens,
        maxTokens: 500_000,
        percentage: tokens / 5000,
        model: 'grok-4.6',
        categories: [{ name: 'input', tokens, color: '#22c55e' }],
      } : null,
    }
    useChatStore.setState({
      activeProject: PROJECT,
      initializedHarnesses: new Set(HARNESSES),
      projectSessions: {
        ...projectSessions,
        [PROJECT]: { ...createDefaultProjectState(), _activeSessionId: SID, _sessions: { [SID]: session } },
      },
    })
    if (tokens > 0) {
      useChatStore.getState().handleAgentEvent({
        type: 'message_usage', projectPath: PROJECT, sessionId: SID, messageId: 'acp_session_grok',
        inputTokens: 0, outputTokens: 0, contextTokens: tokens, contextWindow: 500_000,
      })
    }
    setReady(true)
    return () => useChatStore.setState({ activeProject, projectSessions, initializedHarnesses })
  }, [tokens, detailed])

  return (
    <div style={{ width: narrow ? 280 : 480, maxWidth: '100%' }} className="rounded-xl border border-border bg-background p-4">
      {switchHarness && (
        <div className="mb-4 flex flex-wrap gap-2">
          {HARNESSES.filter((harness) => harness !== 'acp').map((harness) => (
            <button
              key={harness}
              type="button"
              className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
              onClick={() => useChatStore.getState().setPreferredProvider(harness)}
            >
              {harness}
            </button>
          ))}
        </div>
      )}
      <div className="flex h-64 items-end justify-between">
        <span className="text-xs text-muted-foreground">{provider ?? 'acp'}</span>
        <div data-context-ring>{ready && <ContextUsage />}</div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Chat/ContextUsage',
  component: ContextUsagePreview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ContextUsagePreview>
export default meta
type Story = StoryObj<typeof meta>

export const FreshSession: Story = {}
export const GrokInitialization: Story = { args: { tokens: 1359 } }
export const SwitchHarness: Story = { args: { tokens: 1359, switchHarness: true } }
export const SwitchWithDetailedUsage: Story = { args: { tokens: 1359, switchHarness: true, detailed: true } }
export const Expanded: Story = {
  args: { tokens: 1359 },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('[data-context-ring] button')?.click()
  },
}
export const NarrowChinese: Story = {
  ...Expanded,
  args: { tokens: 1359, narrow: true },
  globals: { locale: 'zh' },
}
export const Dark: Story = { ...Expanded, globals: { theme: 'dark' } }
