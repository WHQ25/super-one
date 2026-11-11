import type { Meta, StoryObj } from '@storybook/react-vite'
import { RewindButton } from './RewindButton'
import { useChatStore } from '@/stores/chat'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'

const meta = {
  title: 'Chat/RewindButton', component: RewindButton,
  parameters: { layout: 'centered' }, args: { checkpointId: 'checkpoint' },
  beforeEach: () => {
    const previous = useChatStore.getState()
    const environment = window.environment
    useChatStore.setState({ activeProject: '/storybook', projectSessions: { '/storybook': {
      ...createDefaultProjectState(), _activeSessionId: 'session',
      _sessions: { session: createDefaultPerSessionState() },
    } } })
    window.environment = { ...environment, callSession: async () => ({ canRewind: true, filesChanged: ['src/app.ts'], insertions: 12, deletions: 4 }) } as typeof environment
    return () => { window.environment = environment; useChatStore.setState(previous) }
  },
} satisfies Meta<typeof RewindButton>
export default meta
type Story = StoryObj<typeof meta>
export const Ready: Story = {}
export const CodeAlreadyRestored: Story = { args: { rewound: 'code' } }
/** Antigravity has no rewind protocol, so the history control is omitted. */
export const HiddenForAntigravity: Story = {
  beforeEach: () => {
    const project = useChatStore.getState().projectSessions['/storybook']
    const session = project?._sessions.session
    if (!project || !session) return
    useChatStore.setState({
      projectSessions: {
        '/storybook': {
          ...project,
          _sessions: { session: { ...session, sessionProvider: 'acp-grok', acpAgentId: 'antigravity' } },
        },
      },
    })
  },
}
export const PreviewError: Story = { beforeEach: () => {
  window.environment.callSession = async () => { throw new Error('Preview failed') }
} }
