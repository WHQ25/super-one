import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { Button } from '@superone/ui/components/ui/button'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useRealtimeCallStore } from '@/stores/realtime-call'
import { CodingWorkspace } from '../coding/CodingWorkspace'
import { mosaicTileId, useMosaicStore } from '../mosaic/mosaic-store'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'

const PROJECT = '/storybook/global-voice'
const VOICE = 'global-voice'
const harnesses = Object.keys(HARNESS_CAPABILITIES) as HarnessId[]
mockTranscriptIpc()
mockIpc('agent', 'setSessionForeground', async () => undefined)
mockIpc('agent', 'loadRealtimeTimeline', async () => null)
mockIpc('app', 'getScheduledSend', async () => null)
for (const method of ['getGitInfo', 'getWorktreeInfo']) mockIpc('app', method, async () => null)
mockIpc('app', 'getGitMentionCapabilities', async () => ({}))
mockIpc('app', 'getFullscreen', async () => false)
mockIpc('app', 'codexListModels', async () => [])
mockIpc('app', 'listDeepseekPresets', async () => ({ presets: [], current: null, switchable: false }))
mockIpc('app', 'acpGetSandbox', async () => null)

/** Production workspace and composers; navigation stays offline and never acquires media. */
function Preview() {
  const [ready, setReady] = useState(false)
  const [harness, setHarness] = useState<HarnessId>('claude')
  const mode = useMosaicStore(state => state.mode)
  useEffect(() => {
    const previousChat = useChatStore.getState()
    const previousLayout = useMosaicStore.getState()
    const previousCall = useRealtimeCallStore.getState()
    const previousView = useCodexRealtimeViewStore.getState()
    const previousApp = useAppStore.getState()
    const timer = setTimeout(() => {
      const sessions = Object.fromEntries([...harnesses.map(id => [`text-${id}`, {
        ...createDefaultPerSessionState(), sessionProvider: id, preferredProvider: id, cwd: PROJECT,
        messages: [{ id: `message-${id}`, role: 'user', status: 'complete', content: [{ type: 'text', text: 'Review this project while the global voice session stays connected.' }] }],
      }]), [VOICE, { ...createDefaultPerSessionState(), sessionProvider: 'codex', preferredProvider: 'codex', cwd: PROJECT }]])
      useChatStore.setState({ activeProject: PROJECT, projectSessions: {
        ...previousChat.projectSessions, [PROJECT]: { ...createDefaultProjectState(), _activeSessionId: 'text-claude', _sessions: sessions },
      }, fetchSessions: async () => {}, mountSession: async () => {}, unmountSession: () => {}, switchToSession: async (projectPath, sessionId) => {
        useChatStore.setState(state => ({ activeProject: projectPath, projectSessions: {
          ...state.projectSessions, [projectPath]: { ...state.projectSessions[projectPath], _activeSessionId: sessionId },
        } }))
      } })
      useAppStore.setState({ currentFolder: PROJECT, harnessCatalog: ['claude', 'codex', 'acp-grok', 'opencode', 'cursor', 'dsh'].map(id => ({ id, enabled: true, state: 'ready' })) })
      useMosaicStore.setState({ mode: 'single', root: null, lastLayout: null, focusedTileId: null })
      useCodexRealtimeViewStore.getState().setRealtimeSession(VOICE, 'storybook-call')
      useRealtimeCallStore.setState({ projectPath: PROJECT, sessionId: VOICE, state: 'active', paused: false, microphoneMuted: false })
      setReady(true)
    }, 0)
    return () => {
      clearTimeout(timer)
      useChatStore.setState(previousChat)
      useMosaicStore.setState(previousLayout)
      useRealtimeCallStore.setState(previousCall)
      useCodexRealtimeViewStore.setState(previousView)
      useAppStore.setState(previousApp)
    }
  }, [])
  const textSession = `text-${harness}`
  return <div data-testid="global-voice-preview" className="flex max-w-full flex-col gap-3 text-foreground" style={{ width: 1120 }}>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Harness" value={harness} disabled={!ready} onChange={event => {
        const id = event.target.value as HarnessId
        setHarness(id)
        if (!useMosaicStore.getState().focusOrReplaceFocused(PROJECT, `text-${id}`)) {
          void useChatStore.getState().switchToSession(PROJECT, `text-${id}`)
        }
      }} className="rounded-md border bg-background p-2 text-sm">
        {harnesses.map(id => <option key={id} value={id}>{HARNESS_CAPABILITIES[id].displayName}</option>)}
      </select>
      <Button size="sm" disabled={!ready} onClick={() => {
        useMosaicStore.getState().addTile(PROJECT, VOICE)
        useMosaicStore.getState().setFocus(mosaicTileId(PROJECT, textSession))
      }}>Show voice in split</Button>
      <Button size="sm" disabled={mode !== 'mosaic'} onClick={() => useMosaicStore.getState().exitToSingle()}>Maximize text session</Button>
      <Button size="sm" disabled={mode !== 'mosaic'} onClick={() => useMosaicStore.getState().removeTile(mosaicTileId(PROJECT, VOICE))}>Close voice split</Button>
    </div>
    <div className="relative flex h-[560px] min-w-0 overflow-hidden rounded-xl border bg-card">
      {ready && <CodingWorkspace mosaicMode={mode} />}
    </div>
  </div>
}

const meta = { title: 'Chat/Global voice session', component: Preview, parameters: { layout: 'padded' } } satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>

export const AllHarnessesAndSplit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Show voice in split' })).toBeEnabled())
    for (const id of harnesses) {
      await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Harness' }), id)
      await waitFor(() => expect(canvas.getByRole('button', { name: 'Return to Voice Conversation' })).toBeVisible())
    }
    await userEvent.click(canvas.getByRole('button', { name: 'Show voice in split' }))
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Return to Voice Conversation' })).toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: 'Maximize text session' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Return to Voice Conversation' })).toBeVisible())
    await userEvent.click(canvas.getByRole('button', { name: 'Show voice in split' }))
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Return to Voice Conversation' })).toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: 'Close voice split' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Return to Voice Conversation' })).toBeVisible())
  },
}
export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' } }
