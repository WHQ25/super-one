import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useId, useRef, useState } from 'react'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import i18n from 'i18next'
import type { JSONContent } from '@tiptap/react'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { Button } from '@superone/ui/components/ui/button'
import { AutoResizeTextarea } from '@superone/ui/components/ui/auto-resize-textarea'
import { Label } from '@superone/ui/components/ui/label'
import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'
import type { MediaComposerAPI } from '@superone/shared/media-composer'
import sampleVideo from '../../../../../../mobile/assets/preview/sample-clip.mp4?url'
import { elicitationFormRequest } from '@superone/shared/schema-form'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { ChatContent } from './ChatContent'
import { plainTextToTiptapDoc } from './chat-input/plainTextToTiptapDoc'
import { requestMcpAppConsent } from '@/components/mcp-apps/consent-store'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useRealtimeCallStore } from '@/stores/realtime-call'
import { composerForSession, registerComposer, type OpenedComposerProps } from './composer-slot/composer-registry'

mockIpc('app', 'getMediaServerPort', async () => 6006)
mockIpc('app', 'getGitInfo', async () => null)
mockIpc('app', 'loadSessionState', async () => null)
mockIpc('app', 'getScheduledSend', async () => null)
mockIpc('app', 'connectClaude', async () => ({ models: [], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }))
mockIpc('app', 'connectCodex', async () => ({ models: [], prompts: [] }))
mockIpc('app', 'getModelCatalog', async () => ({ providers: [] }))
mockIpc('app', 'getAppSettings', async () => ({ agentPreference: { claude: {}, codex: {}, acp: {} } }))
mockIpc('app', 'getMcpMetaCache', async () => ({}))
for (const method of ['probeMcpIcons', 'trace']) mockIpc('app', method, async () => undefined)
for (const method of ['listMcpLibrary', 'listInstalledMcpb']) mockIpc('app', method, async () => [])
mockIpc('agent', 'prewarm', async () => undefined)
mockIpc('app', 'collaborationMailbox', Object.assign(() => {}, { list: async () => [], onChanged: () => () => {} }))
for (const method of ['listPlatforms', 'listCredentials', 'listBindings', 'claudeListAccounts']) mockIpc('app', method, async () => [])
for (const method of ['respondToPermission', 'answerQuestion', 'dismissQuestion', 'respondToPlanApproval', 'setPermissionMode']) mockIpc('agent', method, async () => true)
mockIpc('agent', 'respondToPlanApproval', async (...args) => { console.info('[composer-flow] plan response', args); return true })

const projectPath = '__composer_slot_flow__'
const sessionId = 'composer-flow'
const draft = '这是尚未发送的草稿，审批结束后应完整恢复。'
const draftDoc: JSONContent = plainTextToTiptapDoc(draft)
draftDoc.content!.push({ type: 'paragraph', content: [{ type: 'attachment', attrs: { id: PNG_ATTACHMENT.id } }] })

type ComposerFlowScenario = 'text' | 'voice' | 'consent' | 'elicitation' | 'stack' | 'image' | 'video'

function enqueueDecisions(scenario: ComposerFlowScenario) {
  const questionOnly = scenario === 'voice'
  const elicitation = scenario === 'elicitation'
  const stack = scenario === 'stack' || scenario === 'image' || scenario === 'video'
  useChatStore.setState((state) => {
    const project = state.projectSessions[projectPath]
    if (!project) return state
    const session = project._sessions[sessionId]
    return { projectSessions: { ...state.projectSessions, [projectPath]: {
      ...project,
      _sessions: { ...project._sessions, [sessionId]: {
        ...session,
        pendingPermissions: questionOnly ? [] : elicitation ? [{
          requestId: 'flow-elicitation', toolName: 'preferences', input: {}, allowAlwaysAllow: false,
          requestKind: 'mcp_elicitation', serverName: 'fixture', message: 'Review project preferences.',
          ...elicitationFormRequest({ type: 'object', properties: { note: { type: 'string', title: 'Review note' } } }),
        }] : [{ requestId: 'flow-permission', toolName: 'Bash', input: { command: 'bun run typecheck:web', cwd: '/workspace' }, allowAlwaysAllow: false }],
        pendingQuestion: elicitation || stack ? null : { requestId: 'flow-question', questions: [{
          header: '验证范围', question: '你希望先检查哪些改动？', multiSelect: false,
          options: [{ label: '输入区交互', description: '检查审批、草稿恢复和快捷键。' }, { label: '布局与翻译', description: '检查窄屏及中文布局。' }],
        }] },
        pendingPlanApproval: questionOnly || elicitation || stack ? null : {
          requestId: 'flow-plan', planFilePath: '/workspace/plans/composer.md', allowedPrompts: [],
          planContent: '# 统一聊天输入区\n\n## 1. 可插拔输入区\n\n通过同一个注册表切换权限、提问、计划审批、应用授权、语音和文本输入。\n\n## 2. 决策队列\n\n权限按原有顺序展示，然后处理提问，最后进入全屏计划审批。每次只展示一项，不显示排队计数。\n\n## 3. 草稿和焦点\n\n暂时收起文本输入时保留未发送文字、富文本和附件。完成审批后恢复草稿。\n\n## 4. 保留全屏计划审批\n\n计划在原有全屏审查界面阅读和审批，保留划词评论、反馈和批准控制。\n\n## 5. 防止快捷键误触\n\n新提示出现后的 500 毫秒保护 Enter、Space 和数字快捷键。高风险授权使用点击或 Command+Enter。\n\n## 6. 验证\n\n检查窄屏、浅色与深色主题、中文与英文，以及连续审批后的输入恢复。',
        },
      } },
    } } }
  })
}

function StackNoteComposer({ value, onValueChange, submit, cancel, active }: OpenedComposerProps) {
  const id = useId()
  const text = String(value.text ?? '')
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium">{String(value.title)}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>Composer note</Label>
        <AutoResizeTextarea
          id={id} value={text} disabled={!active}
          onValueChange={text => onValueChange({ ...value, text })}
          onSubmit={() => submit({ text })}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!active} onClick={() => submit({ text })}>Submit note</Button>
        <Button size="sm" variant="outline" disabled={!active} onClick={cancel}>Cancel note</Button>
      </div>
    </div>
  )
}

function ComposerFlow({ narrow = false, scenario = 'text' }: { narrow?: boolean; scenario?: ComposerFlowScenario }) {
  const [ready, setReady] = useState(false)
  const [lastSubmission, setLastSubmission] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consentRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const composer = composerForSession({ projectPath, sessionId })
    const unregister = scenario === 'stack' ? registerComposer('fixture.note', StackNoteComposer) : undefined
    const previous = useChatStore.getState()
    const previousCatalog = useAppStore.getState().harnessCatalog
    const previousCalls = useRealtimeCallStore.getState()
    const previousRealtime = useCodexRealtimeViewStore.getState()
    const media = scenario === 'image' || scenario === 'video'
    const previousMedia = window.environment
    let videoChecks = 0
    const fixtureMedia: MediaComposerAPI = {
      mediaModels: async kind => [{ providerId: 'fixture', providerLabel: 'Preview', model: `${kind}-model`, label: kind === 'image' ? 'Image Model' : 'Video Model', default: true }],
      mediaGenerate: async request => {
        await new Promise(resolve => setTimeout(resolve, request.kind === 'image' ? 600 : 0))
        return { generationId: request.requestId, kind: request.kind, status: request.kind === 'image' ? 'succeeded' : 'running', files: request.kind === 'image'
          ? [{ path: '/preview/generated.png', agentPath: '/preview/generated.png', mediaType: PNG_ATTACHMENT.mimeType, base64: PNG_ATTACHMENT.base64 }] : [] }
      },
      mediaCancel: async () => {}, mediaPendingVideos: async () => [],
      mediaVideoStatus: async (_target, generationId) => ({ generationId, kind: 'video', status: ++videoChecks > 1 ? 'succeeded' : 'running',
        files: videoChecks > 1 ? [{ path: new URL(sampleVideo, location.href).href, agentPath: '/preview/generated.mp4', mediaType: 'video/mp4' }] : [] }),
    }
    if (media) window.environment = { ...window.environment, ...fixtureMedia }
    const project = createDefaultProjectState()
    const session = createDefaultPerSessionState()
    Object.assign(session, {
      preferredProvider: scenario === 'voice' ? 'codex' : 'claude', sessionProvider: scenario === 'voice' ? 'codex' : 'claude', permissionMode: 'default',
      draftText: draft, draftJson: draftDoc, attachments: [{ ...PNG_ATTACHMENT, name: 'draft-reference.png' }],
      messages: [
        { id: 'flow-user', role: 'user', timestamp: Date.now(), content: [{ type: 'text', text: '请按计划整理聊天输入区。' }] },
        { id: 'flow-assistant', role: 'assistant', timestamp: Date.now(), content: [{ type: 'text', text: '权限和提问依次进入下方输入区，计划审批保持原来的全屏流程。' }] },
      ],
    })
    useChatStore.setState({ activeProject: projectPath, projectSessions: {
      ...previous.projectSessions, [projectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } },
    } })
    useAppStore.setState({ harnessCatalog: null })
    if (scenario === 'voice') {
      useCodexRealtimeViewStore.getState().setRealtimeSession(sessionId, 'preview-call')
      useRealtimeCallStore.setState({ sessionId, state: 'active' })
    }
    setReady(true)
    return () => {
      composer.returnToChat()
      unregister?.()
      if (timerRef.current) clearTimeout(timerRef.current)
      consentRef.current?.abort()
      useRealtimeCallStore.setState(previousCalls)
      useCodexRealtimeViewStore.setState(previousRealtime)
      useChatStore.setState(previous)
      useAppStore.setState({ harnessCatalog: previousCatalog })
      if (media) window.environment = previousMedia
    }
  }, [scenario])
  const queue = () => {
    enqueueDecisions(scenario)
    if (scenario === 'consent') {
      consentRef.current?.abort()
      const controller = new AbortController()
      consentRef.current = controller
      void requestMcpAppConsent(sessionId, { kind: 'sendMessage', server: 'fixture', text: '这是一条等待决策队列处理完后才显示的应用消息。', nonTextBlocks: 0 }, controller.signal)
    }
  }
  const openNote = (lifetime: 'once' | 'sticky') => {
    void composerForSession({ projectPath, sessionId }).open('fixture.note', {
      lifetime, prefill: { title: lifetime === 'sticky' ? 'Persistent composer' : 'Temporary composer', text: '' },
    }).then(result => setLastSubmission(result ? String(result.text) : 'cancelled'))
  }
  return (
    <TooltipProvider>
      <div className="mx-auto flex min-w-0 flex-col gap-3" style={{ width: narrow ? 320 : 860, maxWidth: '100%' }}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button size="sm" onClick={queue}>加入决策队列</Button>
          <Button size="sm" variant="outline" onClick={() => { timerRef.current = setTimeout(queue, 1500) }}>1.5 秒后加入队列</Button>
          {scenario === 'stack' && <>
            <Button size="sm" variant="outline" onClick={() => openNote('sticky')}>Open persistent composer</Button>
            <Button size="sm" variant="outline" onClick={() => openNote('once')}>Open temporary composer</Button>
            <Button size="sm" variant="outline" onClick={() => composerForSession({ projectPath, sessionId }).returnToChat()}>Return to chat</Button>
            <span data-testid="composer-result">{lastSubmission}</span>
          </>}
          <span>预览数据：审批不会执行命令或发送模型请求。</span>
        </div>
        <div data-testid="composer-flow" className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-background" style={{ height: 690 }}>
          {ready && <ChatContent scrollViewportRef={scrollRef} foreground={false} />}
        </div>
      </div>
    </TooltipProvider>
  )
}

const meta = { title: 'Chat/ComposerSlotFlow', component: ComposerFlow, parameters: { layout: 'padded' } } satisfies Meta<typeof ComposerFlow>
export default meta
type Story = StoryObj<typeof meta>
export const Interactive: Story = {}
export const Narrow: Story = { args: { narrow: true } }
export const DuringVoiceCall: Story = { args: { scenario: 'voice' } }
export const AppConsentWaits: Story = { args: { scenario: 'consent' } }
export const ElicitationWhileTyping: Story = {
  args: { scenario: 'elicitation' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-chat-input-editor]')!)
    // Simulate a request arriving without moving the caret to the preview controls.
    canvas.getByRole('button', { name: '加入决策队列' }).click()
    const field = await canvas.findByRole('textbox', { name: 'Review note' }, { timeout: 4_000 })
    await waitFor(() => expect(canvas.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady'))
    await expect(field).not.toHaveFocus()
    await expect(field).toHaveValue('')
  },
}

export const ComposerStack: Story = {
  args: { scenario: 'stack' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const expectNote = async (value: string) => {
      await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Composer note' })).toHaveValue(value), { timeout: 4_000 })
      await waitFor(() => expect(canvas.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady'), { timeout: 4_000 })
      await expect(canvas.getByRole('textbox', { name: 'Composer note' })).toBeEnabled()
      return canvas.getByRole('textbox', { name: 'Composer note' })
    }
    await userEvent.click(canvas.getByRole('button', { name: 'Open persistent composer' }))
    await fireEvent.change(await expectNote(''), { target: { value: 'persistent draft' } })
    await expectNote('persistent draft')
    await userEvent.click(canvas.getByRole('button', { name: 'Open temporary composer' }))
    await fireEvent.change(await expectNote(''), { target: { value: 'temporary draft' } })
    await expectNote('temporary draft')
    await userEvent.click(canvas.getByRole('button', { name: '加入决策队列' }))
    await userEvent.click(await canvas.findByRole('button', { name: name => name.startsWith(i18n.t('chat.permission.allow')) }, { timeout: 4_000 }))
    await expectNote('temporary draft')
    await userEvent.click(canvas.getByRole('button', { name: 'Submit note' }))
    await expectNote('persistent draft')
    await userEvent.click(canvas.getByRole('button', { name: 'Submit note' }))
    await expectNote('persistent draft')
    await expect(canvas.getByTestId('composer-result')).toHaveTextContent('persistent draft')
    await userEvent.click(canvas.getByRole('button', { name: 'Return to chat' }))
    await waitFor(() => expect(canvasElement.querySelector('[data-chat-input-editor]')).toHaveTextContent(draft), { timeout: 4_000 })
  },
}
export const ComposerStackNarrow: Story = { ...ComposerStack, args: { scenario: 'stack', narrow: true } }

export const NativeImage: Story = {
  args: { scenario: 'image' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('mediaComposer.mode') }))
    await userEvent.click(within(document.body).getByRole('menuitem', { name: i18n.t('mediaComposer.image') }))
    const field = await canvas.findByRole('textbox', { name: i18n.t('mediaComposer.prompt') }, { timeout: 4_000 })
    await waitFor(() => expect(canvas.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady'))
    await fireEvent.change(field, { target: { value: 'A watercolor mountain with a small cabin\nWarm light at dusk' } })
    await userEvent.click(canvas.getByRole('button', { name: i18n.t('mediaComposer.generate') }))
    await userEvent.click(canvas.getByRole('button', { name: '加入决策队列' }))
    await userEvent.click(await canvas.findByRole('button', { name: name => name.startsWith(i18n.t('chat.permission.allow')) }, { timeout: 4_000 }))
    await waitFor(() => expect(canvas.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady'))
    await expect(await canvas.findByRole('textbox', { name: i18n.t('mediaComposer.prompt') })).toHaveValue('A watercolor mountain with a small cabin\nWarm light at dusk')
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('mediaComposer.insert') }, { timeout: 4_000 }))
    await waitFor(() => expect(canvasElement.querySelector('[data-chat-input-editor]')).toHaveTextContent(draft), { timeout: 4_000 })
    await expect(useChatStore.getState().projectSessions[projectPath]._sessions[sessionId].attachments).toHaveLength(2)
  },
}
export const NativeImageNarrow: Story = { ...NativeImage, args: { scenario: 'image', narrow: true } }
export const NativeVideo: Story = {
  args: { scenario: 'video' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('mediaComposer.mode') }))
    await userEvent.click(within(document.body).getByRole('menuitem', { name: i18n.t('mediaComposer.video') }))
    const field = await canvas.findByRole('textbox', { name: i18n.t('mediaComposer.prompt') }, { timeout: 4_000 })
    await waitFor(() => expect(canvas.getByTestId('composer-switch')).toHaveAttribute('data-phase', 'steady'))
    await fireEvent.change(field, { target: { value: 'A slow camera move through a forest' } })
    await userEvent.click(canvas.getByRole('button', { name: i18n.t('mediaComposer.generate') }))
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('mediaComposer.stopPolling') }))
    await userEvent.click(canvas.getByRole('button', { name: i18n.t('mediaComposer.check') }))
    await waitFor(() => expect(canvas.getByRole('button', { name: i18n.t('mediaComposer.check') })).toBeEnabled())
    await userEvent.click(canvas.getByRole('button', { name: i18n.t('mediaComposer.check') }))
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('mediaComposer.insert') }))
    await waitFor(() => expect(canvasElement.querySelector('[data-chat-input-editor]')).toHaveTextContent('/preview/generated.mp4'), { timeout: 4_000 })
    await expect(canvasElement.querySelector('[data-chat-input-editor]')).toHaveTextContent(draft)
  },
}
export const NativeVideoNarrow: Story = { ...NativeVideo, args: { scenario: 'video', narrow: true } }
