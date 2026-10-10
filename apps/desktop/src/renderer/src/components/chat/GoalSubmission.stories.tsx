import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useEffect } from 'react'
import { Button } from '@superone/ui/components/ui/button'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useDraftsStore } from '@/stores/drafts'
import { claimDraftForSession } from '@/stores/chat-store/helpers/draft-promote'
import { ChatMessage } from './ChatMessage'

const projectPath = '/storybook/goal-submission'
const objective = 'Ship the login flow'

function GoalSubmission() {
  const project = useChatStore((state) => state.projectSessions[projectPath])
  const drafts = useDraftsStore((state) => state.byConnection.local)
  const sessionId = project?._activeSessionId
  const session = sessionId ? project?._sessions[sessionId] : undefined
  useEffect(() => {
    const environment = window.environment
    window.environment = { ...environment, deleteDraft: async () => {} }
    claimDraftForSession('goal', 'goal-draft')
    useDraftsStore.setState({ discardedIds: {}, byConnection: { local: [{
      id: 'goal-draft', text: `/goal ${objective}`, title: objective, projectPath,
      docJson: null, attachments: [], harness: 'codex', model: null, permissionMode: null,
      settings: {}, originSessionId: 'goal', createdAt: '', updatedAt: '',
    }] } })
    useChatStore.setState({ activeProject: projectPath, projectSessions: { [projectPath]: {
      ...createDefaultProjectState(), _activeSessionId: 'goal', _sessions: {
        goal: { ...createDefaultPerSessionState(), preferredProvider: 'codex', sessionProvider: 'codex',
          _historyHydrated: true, draftId: 'goal-draft', draftText: `/goal ${objective}` },
        other: { ...createDefaultPerSessionState(), draftText: 'Unsent note in the other session' },
      },
    } } })
    return () => { window.environment = environment }
  }, [])

  const switchTo = (id: string) => useChatStore.setState((state) => ({ projectSessions: {
    ...state.projectSessions, [projectPath]: { ...state.projectSessions[projectPath], _activeSessionId: id },
  } }))
  const submit = () => {
    useChatStore.getState().setDraftText('', { projectPath, sessionId: 'goal' })
    // Receipt of a successful Goal RPC, using the same host event as production.
    useChatStore.getState().handleAgentEvent({ type: 'user_message_appended', projectPath, sessionId: 'goal', message: {
      id: 'accepted-goal', role: 'user', status: 'complete', providerId: 'codex',
      createdAt: new Date().toISOString(), content: [{ type: 'text', text: `/goal ${objective}` }],
    } })
  }
  return <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 rounded-xl border bg-background p-4">
    <div className="flex flex-wrap gap-2">
      <Button onClick={submit} disabled={sessionId !== 'goal' || !!session?.messages.length}>Submit goal</Button>
      <Button variant="outline" onClick={() => switchTo('other')}>Other session</Button>
      <Button variant="outline" onClick={() => switchTo('goal')}>Goal session</Button>
    </div>
    <div aria-label="Conversation">
      {session?.messages.map((message) => <ChatMessage key={message.id} message={message} sessionStatus="idle" isLastAssistant={false} />)}
    </div>
    <p className="text-sm text-muted-foreground">Composer: {session?.draftText || 'Empty'}</p>
    <p className="text-sm text-muted-foreground">Saved drafts: {drafts?.length ?? 0}</p>
  </div>
}

const meta: Meta<typeof GoalSubmission> = {
  title: 'Chat/GoalSubmission', component: GoalSubmission, globals: { harness: 'codex' },
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof GoalSubmission>

export const SendAndSwitch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Submit goal' }))
    await waitFor(() => expect(canvas.getByText('Saved drafts: 0')).toBeVisible())
    expect(canvas.getByText(objective)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Other session' }))
    expect(canvas.queryByText(objective)).toBeNull()
    expect(canvas.getByText('Composer: Unsent note in the other session')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Goal session' }))
    expect(canvas.getByText(objective)).toBeVisible()
    expect(canvas.getByText('Composer: Empty')).toBeVisible()
  },
}
export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' }, play: SendAndSwitch.play }
